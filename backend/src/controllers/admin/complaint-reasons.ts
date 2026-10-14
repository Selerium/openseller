import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { ok, pageOf, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";

const reasonsRouter = express.Router();

reasonsRouter.get("/", async (req, res) => {
  const reasons = await prisma.complaintReason.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  ok(res, reasons);
});

reasonsRouter.post("/", async (req, res) => {
  const { label, sortOrder } = req.body ?? {};
  if (!label || typeof label !== "string" || !label.trim()) {
    throw new AppError("Label is required", 400);
  }
  const reason = await prisma.complaintReason.create({
    data: {
      label: label.trim(),
      sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
      active: true,
    },
  });
  ok(res, reason);
});

reasonsRouter.patch("/:id", async (req, res) => {
  const id = req.params.id;
  const { label, sortOrder, active } = req.body ?? {};
  const data: any = {};
  if (label !== undefined) data.label = label;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;
  if (active !== undefined) data.active = active;
  data.updatedAt = new Date();
  const reason = await prisma.complaintReason.update({
    where: { id },
    data,
  });
  ok(res, reason);
});

reasonsRouter.delete("/:id", async (req, res) => {
  await prisma.complaintReason.update({
    where: { id: req.params.id },
    data: { active: false, updatedAt: new Date() },
  });
  ok(res, { deleted: true });
});

export default reasonsRouter;
