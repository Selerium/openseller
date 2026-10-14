import AppError from "./appError.ts";
import { prisma } from "./prismaClient.ts";

/**
 * One page of a complaint thread, newest-first reads served oldest-first.
 *
 * Threads are append-only, so pagination walks backwards from the newest: `before` is
 * the id of the oldest message the reader already holds, and the page is everything
 * just older than it. The cursor is two-column (createdAt, id) because two messages can
 * share a millisecond, and id alone would skip or repeat the twin.
 *
 * A `before` naming a message from another complaint is a 404, not a 400: confirming
 * that some other id exists is itself a small leak, and the caller learns nothing
 * useful from the difference.
 */

export const MESSAGE_PAGE_DEFAULT = 20;
export const MESSAGE_PAGE_MAX = 50;

/** How many of the newest messages ride along inside order and complaint reads. */
export const MESSAGE_TAIL = 20;

const messageSelect = {
  id: true,
  author: true,
  body: true,
  createdAt: true,
} as const;

export function parseMessageLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return MESSAGE_PAGE_DEFAULT;
  const limit = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AppError("limit must be a whole number of at least 1", 400);
  }
  return Math.min(limit, MESSAGE_PAGE_MAX);
}

export async function pageMessages(
  complaintId: string,
  beforeId: string | null,
  limit: number,
): Promise<{ items: { id: string; author: string; body: string; createdAt: Date }[]; hasMore: boolean }> {
  let cursor: { createdAt: Date } | null = null;
  if (beforeId) {
    const row = await prisma.complaintMessage.findUnique({
      where: { id: beforeId },
      select: { createdAt: true, complaintId: true },
    });
    if (!row || row.complaintId !== complaintId) {
      throw new AppError("Message not found", 404);
    }
    cursor = { createdAt: row.createdAt };
  }

  const rows = await prisma.complaintMessage.findMany({
    where: {
      complaintId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: beforeId as string } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // One extra row decides hasMore without a second count query.
    take: limit + 1,
    select: messageSelect,
  });

  // Read newest-first for the query, served oldest-first for the thread.
  return { items: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
}
