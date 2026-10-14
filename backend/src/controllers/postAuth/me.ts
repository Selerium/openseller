import express from "express";
import jwt from "jsonwebtoken";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { setAccessCookie, clearAuthCookies } from "../../lib/cookies.ts";

const meHandler = express.Router();

meHandler.get("", async (req, res) => {
  // Queried straight from Profile. `req.user.id` is the Profile id (the JWT subject), so
  // going through User to reach its own Profile was a pointless round trip — and it made the
  // old User/Profile split invisible at the call site.
  const profile = await prisma.profile.findUnique({
    where: { id: req.user?.id },
    include: { user: { select: { email: true, emailVerified: true } } },
  });

  if (!profile) {
    // must go through the helper: clearCookie only works if the attributes match the ones
    // the cookie was set with, or the browser keeps the original
    clearAuthCookies(res);
    throw new AppError("User not found", 401);
  }

  const jwtsecret = process.env.JWT_SECRET || "";

  const accessToken = jwt.sign(
    {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      firstTime: profile.firstTime,
    },
    jwtsecret,
    { expiresIn: "15m", subject: profile.id },
  );

  setAccessCookie(res, accessToken);

  res.status(200).json({
    data: {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      firstTime: profile.firstTime,
      // credentials, so they belong on this endpoint rather than being fetched separately
      email: profile.user.email,
      emailVerified: profile.user.emailVerified,
    },
    error: false,
    message: "",
  });
});

export default meHandler;
