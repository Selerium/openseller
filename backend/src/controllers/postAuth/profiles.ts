import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";

const profilesHandler = express.Router();

profilesHandler.get("/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();

  if (!q) {
    res.status(200).json({ data: [], error: false, message: "" });
    return;
  }

  const profiles = await prisma.profile.findMany({
    where: {
      id: { not: req.user!.id },
      name: { contains: q, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: { name: "asc" },
    take: 20,
  });

  res.status(200).json({ data: profiles, error: false, message: "" });
});

profilesHandler.get("/:id", async (req, res) => {
  const profile = await prisma.profile.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { email: true } },
    },
  });

  if (!profile) {
    throw new AppError("Profile not found", 404);
  }

  const isAdmin = req.user!.role === "ADMIN";

  const data = {
    id: profile.id,
    name: profile.name,
    email: isAdmin ? profile.user.email : "",
    phone: isAdmin ? (profile.phone || "") : "",
    role: profile.role || "USER",
    gender: isAdmin ? (profile.gender || "") : "",
    nationality: isAdmin ? (profile.nationality || "") : "",
    dob: isAdmin ? (profile.dob?.toISOString() || "") : "",
    firstTime: profile.firstTime,
  };

  res.status(200).json({ data, error: false, message: "" });
});

export default profilesHandler;
