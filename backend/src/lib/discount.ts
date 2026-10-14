import AppError from "./appError.ts";
import { prisma } from "./prismaClient.ts";

/**
 * Discount codes: percent-off promos applied at checkout.
 *
 * Validation lives here rather than in each route so the public "does this code work?"
 * check and the checkout session that actually charges cannot disagree: both funnel
 * through `redeemableCode`, and the session re-validates at purchase time rather than
 * trusting the percent the client saw a minute ago.
 */

export interface ValidatedDiscount {
  id: string;
  code: string;
  percentOff: number;
}

/** Upper-case, no whitespace: "save10" redeems "SAVE10". Empty input is simply absent. */
export function normalizeDiscountCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");
  return cleaned || null;
}

function parseCodeShape(code: string): string {
  if (code.length < 3 || code.length > 32 || !/^[A-Z0-9_-]+$/.test(code)) {
    throw new AppError(
      "Code must be 3-32 characters of letters, numbers, - or _",
      400,
    );
  }
  return code;
}

export function parsePercentOff(value: unknown): number {
  const percent = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new AppError("Percent off must be a whole number between 1 and 100", 400);
  }
  return percent;
}

export function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AppError(`${field} must be a valid date`, 400);
  return date;
}

export function parseOptionalMaxUses(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const max = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(max) || max < 1) {
    throw new AppError("Max uses must be a whole number of at least 1", 400);
  }
  return max;
}

/**
 * The one check that decides whether a code knocks money off an order.
 *
 * Four independent reasons to refuse, checked cheapest-first: unknown code, switched off,
 * past its expiry, out of redemptions. All four answer the same 400 so the response cannot
 * be used to probe which codes exist beyond what trying them at checkout already shows.
 */
export async function redeemableCode(code: string): Promise<ValidatedDiscount> {
  const row = await prisma.discountCode.findUnique({ where: { code } });
  if (!row) throw new AppError("This discount code is invalid or expired", 400);
  if (!row.active) throw new AppError("This discount code is invalid or expired", 400);
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new AppError("This discount code is invalid or expired", 400);
  }
  if (row.maxUses !== null && row.usedCount >= row.maxUses) {
    throw new AppError("This discount code has reached its usage limit", 400);
  }
  return { id: row.id, code: row.code, percentOff: row.percentOff };
}

/** Whole minor units, rounded half-up, never more than the subtotal itself. */
export function discountCentsFor(subtotalCents: number, percentOff: number): number {
  return Math.min(subtotalCents, Math.round((subtotalCents * percentOff) / 100));
}

/**
 * Claim one redemption of a code that was just validated.
 *
 * Re-checks everything at claim time rather than trusting the earlier read, and the capped
 * case claims with a conditional update (only when uses remain) so two checkouts racing
 * the last redemption cannot both pass: the loser affects zero rows and answers 409
 * instead of overspending the code.
 */
export async function claimRedemption(id: string): Promise<void> {
  const row = await prisma.discountCode.findUnique({
    where: { id },
    select: { maxUses: true, active: true, expiresAt: true },
  });
  if (!row) throw new AppError("This discount code is invalid or expired", 400);
  if (!row.active) throw new AppError("This discount code is invalid or expired", 400);
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new AppError("This discount code is invalid or expired", 400);
  }
  if (row.maxUses === null) {
    await prisma.discountCode.update({ where: { id }, data: { usedCount: { increment: 1 } } });
    return;
  }
  const claimed = await prisma.discountCode.updateMany({
    where: { id, usedCount: { lt: row.maxUses } },
    data: { usedCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw new AppError("This discount code has reached its usage limit", 409);
  }
}

export { parseCodeShape };
