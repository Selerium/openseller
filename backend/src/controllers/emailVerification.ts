import express from "express";
import AppError from "../lib/appError.ts";
import { prisma } from "../lib/prismaClient.ts";
import { hashVerificationToken } from "../lib/verificationToken.ts";

const emailVerificationHandler = express.Router();

emailVerificationHandler.post("", async (req, res) => {
  const token: string = req.body.token;

  if (!token) throw new AppError("Verification token is required", 400);

  const tokenHash = hashVerificationToken(token);

  // The expiry is deliberately NOT part of this query.
  //
  // It used to be: `emailVerificationToken: tokenHash AND expiresAt > now`. Which meant a caller
  // holding a real-but-expired link was indistinguishable from one holding a mangled string, and
  // both got the same 400 reading "Please register again or contact support." For a user who had
  // just changed their address that instruction is impossible to follow -- the account exists
  // under the new address, so re-registering collides with itself. Finding the row first is what
  // makes the two answers separable.
  const user = await prisma.user.findFirst({
    where: { emailVerificationToken: tokenHash },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      emailVerificationTokenExpiresAt: true,
    },
  });

  // No row at all: a typo, a truncated paste, a link whose token was already consumed (verifying
  // clears it), or one superseded by a later email change. Deliberately reveals nothing about
  // which, and returns no address -- a caller who cannot produce a live token has earned nothing.
  if (!user) {
    throw new AppError(
      "This verification link is not valid. It may already have been used, or replaced by a newer one.",
      400,
    );
  }

  const { emailVerificationTokenExpiresAt } = user;

  if (!emailVerificationTokenExpiresAt || emailVerificationTokenExpiresAt <= new Date()) {
    // 410, not 400. The link was genuine and the thing it addressed is gone, which is what Gone
    // is for, and it is the status that tells the client to offer a fresh link rather than
    // report a dead end.
    //
    // The address comes back with it. The caller has demonstrated they received mail at that
    // address -- the same proof verification itself demands -- so this discloses nothing new, and
    // it saves the one step most likely to be abandoned: retyping an address the user has
    // already proven they own.
    throw new AppError("This verification link has expired.", 410, {
      canResend: true,
      email: user.email,
    });
  }

  // Unconditional, including when emailVerified is already true. Clearing the token is the part
  // that matters -- it is what makes the link single-use -- and a row still holding a token after
  // verification is not a state worth branching around.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationTokenExpiresAt: null,
    },
  });

  res.status(200).json({
    data: { email: user.email },
    message: "Email verified",
    error: false,
  });
});

export default emailVerificationHandler;
