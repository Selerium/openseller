import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prismaClient.ts";
import AppError from "../lib/appError.ts";

const resetPasswordHandler = express.Router();

resetPasswordHandler.post("", async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    throw new AppError("Token and password are required", 400);
  }

  if (password.length < 8) {
    throw new AppError("Password must be at least 8 characters", 400);
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!resetToken || resetToken.expiresAt < new Date()) {
    throw new AppError("Invalid or expired reset link", 400);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id: resetToken.userId },
    data: { password: hashedPassword },
  });

  await prisma.passwordResetToken.deleteMany({
    where: { userId: resetToken.userId },
  });

  res.status(200).json({ data: null, error: false, message: "" });
});

export default resetPasswordHandler;
