import express from "express";
import AppError from "../../lib/appError.ts";
import jwt from "jsonwebtoken";
import { prisma, Gender } from "../../lib/prismaClient.ts";
import { parseEnum } from "../../lib/http.ts";
import { setAccessCookie } from "../../lib/cookies.ts";

const firstTimeHandler = express.Router();

firstTimeHandler.post("", async (req, res) => {
  const {
    gender,
    dob,
    nationality,
    phone,
  } = req.body;

  if (!gender || !dob || !nationality || !phone) {
    throw new AppError("Missing required fields", 400);
  }

  // A whitespace-only gender passes the presence check above; without this it would reach
  // Prisma and come back as a 500, or worse, leave the required field unset on the profile.
  const validGender = parseEnum(gender, Gender, "gender");
  if (!validGender) throw new AppError("Missing required fields", 400);

  const data: Record<string, unknown> = {
    gender: validGender,
    dob: new Date(dob),
    nationality,
    phone,
    firstTime: false,
  };

  const profile = await prisma.profile.update({
    where: { id: req.user.id },
    data,
    include: {
      user: { select: { email: true } },
    },
  });

  const jwtsecret = process.env.JWT_SECRET || "";
  const accessToken = jwt.sign(
    {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      firstTime: false,
    },
    jwtsecret,
    { expiresIn: "15m", subject: profile.id }
  );

  setAccessCookie(res, accessToken);

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

export default firstTimeHandler;
