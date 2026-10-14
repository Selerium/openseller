import express from "express";
import bcrypt from "bcryptjs";
import isEmail from "validator/lib/isEmail.js";
import AppError from "../../lib/appError.ts";
import { prisma, Gender } from "../../lib/prismaClient.ts";
import { parseEnum } from "../../lib/http.ts";
import { config } from "../../lib/config.ts";
import { sendVerificationEmail } from "../../lib/email.ts";
import { normalizeEmail } from "../../lib/emailAddress.ts";
import { issueVerificationToken } from "../../lib/verificationToken.ts";

const profileHandler = express.Router();

profileHandler.get("", async (req, res) => {
  const profile = await prisma.profile.findUnique({
    where: { id: req.user.id },
    include: {
      user: { select: { email: true } },
    },
  });

  if (!profile) {
    throw new AppError("Profile not found", 404);
  }

  const data = {
    createdAt: profile.createdAt,
    user: { name: profile.name, email: profile.user.email },
    role: profile.role,
    firstTime: profile.firstTime,
    gender: profile.gender,
    dob: profile.dob,
    nationality: profile.nationality,
    phone: profile.phone,
  };

  res.status(200).json({ data, error: false, message: "" });
});

profileHandler.put("", async (req, res) => {
  const {
    name,
    phone,
    dob,
    gender,
    nationality,
  } = req.body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (dob !== undefined) data.dob = new Date(dob);
  if (gender !== undefined) {
    // null clears the field (Gender is nullable); anything else has to be a real member,
    // and an unknown one is a 400 rather than a Prisma validation error surfacing as a 500.
    data.gender = gender === null ? null : parseEnum(gender, Gender, "gender");
  }
  if (nationality !== undefined) data.nationality = nationality;

  const profile = await prisma.profile.update({
    where: { id: req.user.id },
    data,
    include: {
      user: { select: { email: true } },
    },
  });

  const response = {
    createdAt: profile.createdAt,
    user: { name: profile.name, email: profile.user.email },
    role: profile.role,
    firstTime: profile.firstTime,
    gender: profile.gender,
    dob: profile.dob,
    nationality: profile.nationality,
    phone: profile.phone,
  };

  res.status(200).json({ data: response, error: false, message: "" });
});

profileHandler.put("/password", async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError("Current password and new password are required", 400);
  }

  if (currentPassword === newPassword) {
    throw new AppError("New password is the same as old password", 400);
  }

  if (newPassword.length < 8) {
    throw new AppError("New password must be at least 8 characters", 400);
  }

  const profile = await prisma.profile.findUnique({
    where: { id: req.user.id },
    include: { user: { select: { id: true, password: true } } },
  });

  if (!profile) {
    throw new AppError("Profile not found", 404);
  }

  const valid = await bcrypt.compare(currentPassword, profile.user.password);
  if (!valid) {
    throw new AppError("Current password is incorrect", 401);
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: profile.user.id },
    data: { password: hashed },
  });

  res.status(200).json({ data: {}, error: false, message: "Password updated" });
});

profileHandler.put("/email", async (req, res) => {
  const { currentPassword, newEmail } = req.body;

  if (!currentPassword || !newEmail) {
    throw new AppError("Current password and new email are required", 400);
  }

  // Normalized before validation, and before anything touches the database. Trimming is what
  // stops a pasted trailing space from being rejected outright as malformed, and storing the
  // untrimmed form would be unrecoverable: login normalizes its input too, so the row would hold
  // an address no lookup could match, locking the account out of the only path that can change it
  // back. See register.ts for why this order and not the reverse.
  const email = normalizeEmail(newEmail);

  if (!isEmail(email)) {
    throw new AppError("Invalid email address", 400);
  }

  const profile = await prisma.profile.findUnique({
    where: { id: req.user.id },
    include: { user: { select: { id: true, password: true } } },
  });

  if (!profile) {
    throw new AppError("Profile not found", 404);
  }

  const valid = await bcrypt.compare(currentPassword, profile.user.password);
  if (!valid) {
    throw new AppError("Current password is incorrect", 401);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== profile.user.id) {
    throw new AppError("Email is already in use", 409);
  }

  // Changing the address invalidates the old verification. Leaving emailVerified true would
  // claim the new address is proven when nobody has received mail there yet, and it would
  // leave the account able to skip verification entirely by swapping in an attacker's
  // address. So: revoke, then re-issue the flow for the new address.
  //
  // emailChangedAt is what tells cleanupUnverifiedUsers this account is a real one mid-verify
  // rather than an abandoned signup. See lib/tokenCleanup.ts for why createdAt cannot.
  const { token, tokenHash, expiresAt } = issueVerificationToken();

  await prisma.user.update({
    where: { id: profile.user.id },
    data: {
      email,
      emailVerified: false,
      emailVerificationToken: tokenHash,
      emailVerificationTokenExpiresAt: expiresAt,
      emailChangedAt: new Date(),
    },
  });

  const verificationUrl = `${config.storeUrl}/verify-email?token=${token}`;

  try {
    await sendVerificationEmail(email, verificationUrl);
  } catch (err) {
    // The address is already changed. Reporting failure here would tell the user to retry a
    // change that has in fact been applied, and a retry would then hit the 409 above.
    // /resend-verification can issue a new link.
    console.error("Email changed but verification email failed to send:", err);
  }

  res.status(200).json({
    data: { email, emailVerified: false },
    error: false,
    message: "Email updated. Check the new address to verify it.",
  });
});

export default profileHandler;
