import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { ok, created } from "../../lib/http.ts";
import {
  normalizeDiscountCode,
  parseCodeShape,
  parseOptionalDate,
  parseOptionalMaxUses,
  parsePercentOff,
} from "../../lib/discount.ts";

/**
 * Discount codes, managed from the admin dashboard.
 *
 * Mounted under /admin (requireAdmin), so every route here is admin-only by construction.
 * Codes are snapshotted onto orders at purchase time, so editing or deleting a code never
 * rewrites history — it only changes what future checkouts accept.
 */
const discountsRouter = express.Router();

function toResponse(row: {
  id: string;
  code: string;
  percentOff: number;
  active: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    code: row.code,
    percentOff: row.percentOff,
    active: row.active,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    usesLeft: row.maxUses === null ? null : Math.max(0, row.maxUses - row.usedCount),
    expired: row.expiresAt !== null && row.expiresAt.getTime() <= Date.now(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** GET /admin/discounts — newest first. */
discountsRouter.get("", async (_req, res) => {
  const rows = await prisma.discountCode.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  ok(res, rows.map(toResponse));
});

/** POST /admin/discounts — create a code. */
discountsRouter.post("", async (req, res) => {
  const raw = normalizeDiscountCode(req.body?.code);
  if (!raw) throw new AppError("A code is required", 400);
  const code = parseCodeShape(raw);
  const percentOff = parsePercentOff(req.body?.percentOff);
  const expiresAt = parseOptionalDate(req.body?.expiresAt, "Expiry");
  const maxUses = parseOptionalMaxUses(req.body?.maxUses);
  const active = req.body?.active === undefined ? true : req.body.active === true;

  const existing = await prisma.discountCode.findUnique({ where: { code } });
  if (existing) throw new AppError("That code already exists", 409);

  const row = await prisma.discountCode.create({
    data: { code, percentOff, expiresAt, maxUses, active },
  });
  created(res, toResponse(row), `Code ${code} created`);
});

/** PATCH /admin/discounts/:id — toggle or retune a code. The code string itself is immutable. */
discountsRouter.patch("/:id", async (req, res) => {
  const row = await prisma.discountCode.findUnique({ where: { id: req.params.id } });
  if (!row) throw new AppError("Discount code not found", 404);

  const body = req.body ?? {};
  const data: {
    percentOff?: number;
    active?: boolean;
    expiresAt?: Date | null;
    maxUses?: number | null;
  } = {};
  if (body.percentOff !== undefined) data.percentOff = parsePercentOff(body.percentOff);
  if (body.active !== undefined) data.active = body.active === true;
  // Null clears the field, so an expiry or a cap can be lifted as well as set.
  if (body.expiresAt !== undefined) data.expiresAt = parseOptionalDate(body.expiresAt, "Expiry");
  if (body.maxUses !== undefined) data.maxUses = parseOptionalMaxUses(body.maxUses);

  const updated = await prisma.discountCode.update({ where: { id: row.id }, data });
  ok(res, toResponse(updated), `Code ${row.code} updated`);
});

/** DELETE /admin/discounts/:id — past orders keep their snapshot, so this is always safe. */
discountsRouter.delete("/:id", async (req, res) => {
  const row = await prisma.discountCode.findUnique({ where: { id: req.params.id } });
  if (!row) throw new AppError("Discount code not found", 404);

  await prisma.discountCode.delete({ where: { id: row.id } });
  ok(res, {}, `Code ${row.code} deleted`);
});

export default discountsRouter;
