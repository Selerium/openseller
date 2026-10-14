import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { ok } from "../../lib/http.ts";

/**
 * The signed-in profile's inbox.
 *
 * Guarded by checkTokens at the mount (see routeGuard.ts), so req.user.id is the reader's
 * own Profile id and every query is scoped by it. Rows are written by lib/notify.ts from
 * complaint, order and review flows; this router only reads them and marks them read.
 * Deleting is not offered: the inbox is an audit trail, and read/unread is the whole of
 * its state.
 */
const notificationsRouter = express.Router();

const toResponse = (row: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  link: row.link,
  readAt: row.readAt,
  createdAt: row.createdAt,
});

/** GET /notifications — newest first, with the unread count the bell renders. */
notificationsRouter.get("", async (req, res) => {
  const profileId = req.user.id;
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { profileId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.notification.count({ where: { profileId, readAt: null } }),
  ]);
  ok(res, { items: rows.map(toResponse), unread });
});

/** PATCH /notifications — mark read. No ids means all; otherwise only the caller's own. */
notificationsRouter.patch("", async (req, res) => {
  const profileId = req.user.id;
  const ids = req.body?.ids;

  if (ids !== undefined && !Array.isArray(ids)) {
    throw new AppError("ids must be an array", 400);
  }

  const updated = await prisma.notification.updateMany({
    where: {
      profileId,
      readAt: null,
      ...(Array.isArray(ids) && ids.length > 0 ? { id: { in: ids.filter((id) => typeof id === "string") } } : {}),
    },
    data: { readAt: new Date() },
  });

  ok(res, { marked: updated.count }, updated.count === 1 ? "Marked as read" : "Marked all as read");
});

export default notificationsRouter;
