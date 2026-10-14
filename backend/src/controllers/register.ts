import express from "express";
import bcrypt from "bcryptjs";
import isEmail from "validator/lib/isEmail.js";
import AppError from "../lib/appError.ts";
import { prisma, Role } from "../lib/prismaClient.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { sendVerificationEmail } from "../lib/email.ts";
import { config } from "../lib/config.ts";
import { normalizeEmail } from "../lib/emailAddress.ts";
import { issueVerificationToken } from "../lib/verificationToken.ts";

const registerHandler = express.Router();

registerHandler.post("", async (req, res) => {
  const fullName: string = req.body.fullName;
  const rawEmail: string = req.body.email;
  const password: string = req.body.password;
  const confirmPassword: string = req.body.confirmPassword;

  if (!fullName || !rawEmail || !password || !confirmPassword)
    throw new AppError("Missing fields", 400);
  else if (password.length < 8) throw new AppError("Password too short", 400);
  else if (password.localeCompare(confirmPassword) !== 0)
    throw new AppError("Passwords do not match", 400);

  // Normalized *before* validation, not after. A pasted address routinely arrives with a
  // trailing space or newline, and validator's isEmail rejects whitespace around the local part
  // -- so validating first turns a real address into "Invalid email address", with nothing on
  // screen to suggest a stray space is the cause. Normalizing first accepts what the user meant
  // and still rejects genuinely malformed input.
  //
  // Order matters in the other direction too: the stored value is what gets validated, so a
  // padded form can never end up as the database key.
  const email = normalizeEmail(rawEmail);

  if (!isEmail(email)) throw new AppError("Invalid email address", 400);

  const hashedPassword = await bcrypt.hash(password, 10);
  let newUser: { id: string; email: string };
  try {
    const created = await prisma.user.create({
      data: {
        email: email,
        password: hashedPassword,
        profile: {
          create: {
            name: fullName,
            role: Role.USER,
          },
        },
      },
      select: {
        id: true,
        email: true,
      },
    });
    newUser = created;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError)
      if (e.code === "P2002") throw new AppError("Email already in use", 409);
    throw new AppError("Failed to create user", 400);
  }

  const { token, tokenHash, expiresAt } = issueVerificationToken();

  await prisma.user.update({
    where: { id: newUser.id },
    data: {
      emailVerificationToken: tokenHash,
      emailVerificationTokenExpiresAt: expiresAt,
    },
  });

  // config.storeUrl, not FRONTEND_URL: the latter is a comma-separated CORS allow-list, so
  // interpolating it would build "http://a.example,http://b.example/verify-email?...".
  const verificationUrl = `${config.storeUrl}/verify-email?token=${token}`;

  try {
    await sendVerificationEmail(email, verificationUrl);
  } catch (e) {
    await prisma.profile.delete({ where: { userId: newUser.id } });
    await prisma.user.delete({ where: { id: newUser.id } });
    throw new AppError(
      "Could not send verification email. Please try again.",
      500
    );
  }

  res.status(200).json({
    data: { id: newUser.id, email: newUser.email },
    message: "",
    error: false,
  });
});

export default registerHandler;