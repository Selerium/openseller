import express from "express";
import crypto from "crypto";
import { prisma } from "../lib/prismaClient.ts";
import { sendPasswordResetEmail } from "../lib/email.ts";
import { config } from "../lib/config.ts";

const forgotPasswordHandler = express.Router();

forgotPasswordHandler.post("", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(200).json({ data: null, error: false, message: "" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (user) {
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    const token = crypto.randomBytes(32).toString("hex");

    await prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // config.storeUrl, not FRONTEND_URL: the latter is a comma-separated CORS allow-list, so
    // interpolating it would build "http://a.example,http://b.example/reset-password?...".
    const resetUrl = `${config.storeUrl}/reset-password?token=${token}`;

    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      console.error("Failed to send password reset email:", err);
    }
  }

  res.status(200).json({ data: null, error: false, message: "" });
});

export default forgotPasswordHandler;
