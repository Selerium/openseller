import AppError from "../../lib/appError.ts";
import express from "express";
import { prisma, ComplaintStatus } from "../../lib/prismaClient.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { ok, pageOf, parseEnum, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";
import { notify } from "../../lib/notify.ts";
import { publish } from "../../lib/realtime.ts";
import { MESSAGE_TAIL, pageMessages, parseMessageLimit } from "../../lib/messages.ts";

const complaintsRouter = express.Router();

// The detail route below matches on it; without the declaration every lookup threw a
// ReferenceError and answered 500, and a non-uuid id is simply a row that does not exist.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /admin/complaints */
complaintsRouter.get("", async (req, res) => {
  const { page, perPage, skip, take } = parsePage(req.query);
  const status = parseEnum(req.query.status, ComplaintStatus, "status");
  const search = String(req.query.search ?? "").trim();
  const category = String(req.query.category ?? "").trim();
  const product = String(req.query.product ?? "").trim();
  const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
  const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;

  const where: Prisma.ComplaintWhereInput = {
    ...(status ? { status } : {}),
    ...(category ? { reason: category as any } : {}),
    ...(product
      ? {
          order: {
            items: {
              some: {
                OR: [
                  { title: { contains: product, mode: "insensitive" as const } },
                  { productId: product },
                ],
              },
            },
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { profile: { user: { email: { contains: search, mode: "insensitive" as const } } } },
            { profile: { name: { contains: search, mode: "insensitive" as const } } },
            { guestEmail: { contains: search, mode: "insensitive" as const } },
            { order: { number: { equals: Number(search) || -1 } } },
          ],
        }
      : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
  };

  const orderBy: Prisma.ComplaintOrderByWithRelationInput[] = [{ createdAt: "desc" }, STABLE_ID_ORDER];

  const [total, complaints] = await Promise.all([
    prisma.complaint.count({ where }),
    prisma.complaint.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        order: { select: { id: true, number: true, items: { select: { id: true, title: true, productId: true } } } },
        profile: {
          include: {
            user: true,
          },
        },
        _count: { select: { messages: true } },
      },
    }),
  ]);

  ok(
    res,
    pageOf(
      complaints.map((c: any) => ({
        id: c.id,
        orderId: c.orderId,
        orderNumber: c.order.number,
        profileId: c.profileId,
        email: c.profile?.user?.email ?? c.guestEmail ?? null,
        name: c.profile?.name ?? null,
        reason: c.reason,
        status: c.status,
        details: c.details,
        resolution: c.resolution,
        messageCount: c._count?.messages ?? 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        products: c.order.items.map((i: any) => ({ id: i.productId, title: i.title })),
      })),
      total,
      page,
      perPage,
    ),
  );
});

/** GET /admin/complaints/:id */
complaintsRouter.get("/:id", async (req, res) => {
  const id = req.params.id;
  const where: Prisma.ComplaintWhereInput = UUID.test(id) ? { id } : { id };

  // Selected field by field, never `include: { order: true }`: the order row carries the
  // guest token hash and the user row carries the password hash, and a support screen has
  // no business putting either on the wire.
  const complaint = await prisma.complaint.findFirst({
    where,
    select: {
      id: true,
      orderId: true,
      orderItemId: true,
      reason: true,
      details: true,
      status: true,
      resolution: true,
      resolvedAt: true,
      resolvedBy: true,
      createdAt: true,
      updatedAt: true,
      profile: {
        select: {
          id: true,
          name: true,
          user: { select: { email: true } },
        },
      },
      guestEmail: true,
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          payment: true,
          currency: true,
          subtotalCents: true,
          discountCode: true,
          discountCents: true,
          shippingCents: true,
          taxCents: true,
          totalCents: true,
          guestEmail: true,
          createdAt: true,
          items: {
            orderBy: { title: "asc" },
            select: {
              id: true,
              title: true,
              variantName: true,
              quantity: true,
              unitPriceCents: true,
            },
          },
          events: {
            orderBy: { createdAt: "asc" },
            select: { id: true, type: true, note: true, adminOnly: true, createdAt: true },
          },
        },
      },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MESSAGE_TAIL + 1,
        select: { id: true, author: true, body: true, createdAt: true },
      },
      _count: { select: { messages: true } },
    },
  });

  if (!complaint) throw new AppError("Complaint not found", 404);
  // Newest page, oldest-first — same tail contract as the order serializers.
  // `_count` is consumed, not forwarded: the reader gets `messageCount` instead.
  const { _count, ...rest } = complaint;
  ok(res, {
    ...rest,
    messageCount: _count.messages,
    messages: [...complaint.messages].slice(0, MESSAGE_TAIL).reverse(),
  });
});

/**
 * GET /admin/complaints/:id/messages — one thread page, newest first.
 *
 * The detail read embeds the newest page; the thread pulls older ones through here as
 * the reader scrolls up. Same paging contract as the shopper-facing endpoint.
 */
complaintsRouter.get("/:id/messages", async (req, res) => {
  const complaint = await prisma.complaint.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!complaint) throw new AppError("Complaint not found", 404);

  const rawBefore = req.query.before;
  const before =
    rawBefore === undefined || rawBefore === null || rawBefore === ""
      ? null
      : String(rawBefore);
  ok(res, await pageMessages(complaint.id, before, parseMessageLimit(req.query.limit)));
});

/**
 * POST /admin/complaints/:id/messages — reply as support.
 *
 * A reply never moves the status on its own: closing a dispute is a decision, taken with
 * the resolve button (POST /:id/resolve) or the PATCH below, not a side effect of typing.
 * Replies stay out of the order timeline — the thread itself is the record — so this
 * writes only the message row.
 */
complaintsRouter.post("/:id/messages", async (req, res) => {
  const complaint = await prisma.complaint.findUnique({
    where: { id: req.params.id },
    include: { order: { select: { id: true, number: true, profileId: true } } },
  });
  if (!complaint || !complaint.order) throw new AppError("Complaint not found", 404);

  const raw = req.body?.body;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AppError("Please write a message", 400);
  }
  if (raw.trim().length > 2000) {
    throw new AppError("Please keep messages under 2000 characters", 400);
  }

  const message = await prisma.complaintMessage.create({
    data: {
      complaintId: complaint.id,
      author: "ADMIN",
      // req.user.id is the admin's Profile id (see addresses.ts). Recorded so the thread
      // knows which staffer wrote what, without ever joining User (password hashes must
      // not travel on a support read).
      authorProfileId: req.user?.id ?? null,
      body: raw.trim(),
    },
  });

  ok(res, message, "Reply sent");

  // The live thread for anyone watching, plus the shopper's inbox for everyone else. A
  // guest order adopted after filing already has a profile; a still-guest order has
  // nobody to notify, and its holder watches the thread itself.
  publish(`complaint:${complaint.id}`, "message.created", {
    id: message.id,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt,
  });
  const ownerId = complaint.profileId ?? complaint.order.profileId;
  if (ownerId) {
    void notify(ownerId, {
      type: "complaint.message",
      title: `Support replied on order #${complaint.order.number}`,
      body: message.body,
      link: `/profile/orders/${complaint.orderId}`,
    }).catch(() => {});
  }
});

/** PATCH /admin/complaints/:id */
complaintsRouter.patch("/:id", async (req, res) => {
  const id = req.params.id;
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: { order: true },
  });
  if (!complaint) throw new AppError("Complaint not found", 404);

  const { status, resolution, action, message } = req.body ?? {};
  const newStatus = parseEnum(status, ComplaintStatus, "status") ?? complaint.status;
  const msg = message || resolution || complaint.resolution;

  // resolvedAt/resolvedBy are maintained alongside the status so "who closed this and when"
  // is answerable without reading the timeline: set on close, cleared on reopen.
  const closing = newStatus === "RESOLVED" && complaint.status !== "RESOLVED";
  const reopening =
    (newStatus === "OPEN" || newStatus === "ACKNOWLEDGED") &&
    (complaint.status === "RESOLVED" || complaint.status === "DISMISSED");

  const updated = await prisma.complaint.update({
    where: { id },
    data: {
      status: newStatus,
      resolution: msg,
      updatedAt: new Date(),
      ...(closing ? { resolvedAt: new Date(), resolvedBy: req.user?.id ?? null } : {}),
      ...(reopening ? { resolvedAt: null, resolvedBy: null } : {}),
    },
  });

  // Write event
  await prisma.orderEvent.create({
    data: {
      orderId: complaint.orderId,
      type: "complaint.updated",
      note: `Complaint ${newStatus.toLowerCase()}${msg ? `: ${msg}` : ""}`,
    },
  });

  ok(res, updated);

  // The live thread for anyone watching, plus the shopper's inbox. Skipped when nothing
  // visible changed (same status resent), so a double-click does not notify twice.
  if (newStatus !== complaint.status) {
    publish(`complaint:${id}`, "complaint.updated", {
      id: updated.id,
      status: updated.status,
      resolution: updated.resolution,
    });
    const ownerId = complaint.profileId ?? complaint.order.profileId;
    if (ownerId) {
      void notify(ownerId, {
        type: "complaint.status",
        title: `Complaint ${newStatus.toLowerCase()} on order #${complaint.order.number}`,
        body: msg ?? null,
        link: `/profile/orders/${complaint.orderId}`,
      }).catch(() => {});
    }
  }
});

/** POST /admin/complaints/:id/refund */
complaintsRouter.post("/:id/refund", async (req, res) => {
  const id = req.params.id;
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: { order: true },
  });
  if (!complaint) throw new AppError("Complaint not found", 404);

  const message = req.body?.message;

  // Import stripe client
  const { stripeClient } = await import("../../lib/stripe.ts");
  const { PaymentStatus, OrderStatus } = await import("../../lib/prismaClient.ts");

  if (complaint.order.payment === PaymentStatus.REFUNDED || complaint.order.status === OrderStatus.REFUNDED) {
    await prisma.complaint.update({
      where: { id },
      data: { status: "RESOLVED", resolution: message || complaint.resolution },
    });
    return ok(res, { refunded: false, alreadyRefunded: true });
  }

  if (complaint.order.payment !== PaymentStatus.PAID) {
    throw new AppError("Only a paid order can be refunded", 409);
  }

  let refundId: string | null = null;
  if (complaint.order.stripePaymentIntentId) {
    try {
      const refund = await stripeClient().refunds.create({
        payment_intent: complaint.order.stripePaymentIntentId,
      });
      refundId = refund.id;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const detail = error instanceof Error ? error.message : "unknown error";
      throw new AppError(`Stripe could not refund this order: ${detail}`, 502);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: complaint.orderId },
      data: { status: OrderStatus.REFUNDED, payment: PaymentStatus.REFUNDED },
    });
    await tx.complaint.update({
      where: { id },
      data: { status: "RESOLVED", resolution: message || complaint.resolution },
    });
    await tx.orderEvent.create({
      data: {
        orderId: complaint.orderId,
        type: "refund.issued",
        note: refundId ? `Refund issued (${refundId})` : "Refund recorded",
      },
    });
  });

  ok(res, { refunded: true, refundId });

  publish(`complaint:${id}`, "complaint.updated", { id, status: "RESOLVED" });
  const refundOwnerId = complaint.profileId ?? complaint.order.profileId;
  if (refundOwnerId) {
    void notify(refundOwnerId, {
      type: "complaint.status",
      title: `Order #${complaint.order.number} refunded`,
      body: message ?? null,
      link: `/profile/orders/${complaint.orderId}`,
    }).catch(() => {});
  }
});

/** POST /admin/complaints/:id/resolve */
complaintsRouter.post("/:id/resolve", async (req, res) => {
  const id = req.params.id;
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: { order: true },
  });
  if (!complaint) throw new AppError("Complaint not found", 404);

  const message = req.body?.message || req.body?.resolution;

  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolution: message,
        resolvedAt: new Date(),
        resolvedBy: req.user?.id ?? null,
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: complaint.orderId,
        type: "complaint.resolved",
        note: message ? `Complaint resolved: ${message}` : "Complaint resolved",
      },
    });
  });

  ok(res, { resolved: true });

  publish(`complaint:${id}`, "complaint.updated", {
    id,
    status: "RESOLVED",
    resolution: message ?? complaint.resolution,
  });
  const ownerId = complaint.profileId ?? complaint.order.profileId;
  if (ownerId) {
    void notify(ownerId, {
      type: "complaint.status",
      title: `Complaint resolved on order #${complaint.order.number}`,
      body: message ?? complaint.resolution ?? null,
      link: `/profile/orders/${complaint.orderId}`,
    }).catch(() => {});
  }
});
export default complaintsRouter;
