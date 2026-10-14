import express from "express";
import AppError from "../lib/appError.ts";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prismaClient.ts";
import { setAuthCookies } from "../lib/cookies.ts";
import { signAccessToken, signRefreshToken, hashRefreshToken } from "../lib/tokens.ts";
import { normalizeEmail } from "../lib/emailAddress.ts";

const loginHandler = express.Router();

loginHandler.post("", async (req, res) => {
  const email: string = req.body.email;
  const password: string = req.body.password;

  if (!email || !password) throw new AppError("Missing fields", 400);

  // Normalized to match how the address was stored. Without this, login is the one path that
  // compares raw strings against rows every other path normalized on the way in, so a mixed-case
  // address was unreachable here and nowhere else. findUnique rather than findFirst now that
  // email is @unique: same row, and it says so.
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    include: {
      profile: true,
    },
  });

  if (!user) throw new AppError("User doesn't exist", 404);

  // Profile is created alongside User in register.ts, but the relation is nullable in the
  // schema, so a row written without one would otherwise crash here on a property of null.
  if (!user.profile) throw new AppError("User has no profile", 500);

  const passCheck = await bcrypt.compare(password, user.password);
  if (!passCheck) throw new AppError("Password is incorrect", 401);

  if (!user.emailVerified)
    throw new AppError("Please verify your email address first", 403);

  const jwtsecret = process.env.JWT_SECRET || "";

  const accessToken = signAccessToken({
    id: user.profile.id,
    name: user.profile.name,
    role: user.profile.role,
    firstTime: user.profile.firstTime,
  });
  const refreshToken = signRefreshToken(user.id);

  // No retry loop: it existed to survive a collision on the unique tokenHash column, but the
  // column now holds a SHA-256 digest, and two distinct inputs colliding on 256 bits is not a
  // condition worth carrying three attempts of dead code for.
  await prisma.refreshTokens.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
      userId: user.id,
    },
  });

  setAuthCookies(res, accessToken, refreshToken);
  return res.status(200).json({ data: {}, message: "Login successful", error: false });
});

export default loginHandler;
