import AppError from "../../lib/appError.ts";
import express from "express";
import { prisma, ComplaintStatus } from "../../lib/prismaClient.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { ok, pageOf, parseEnum, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";

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

  const complaint = await prisma.complaint.findFirst({
    where,
    include: {
      order: true,
      profile: { 
        include: {
          user: true
        }
      },
    },
  });

  if (!complaint) throw new AppError("Complaint not found", 404);
  ok(res, complaint);
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

  const updated = await prisma.complaint.update({
    where: { id },
    data: {
      status: newStatus,
      resolution: msg,
      updatedAt: new Date(),
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
      data: { status: "RESOLVED", resolution: message },
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
});
export default complaintsRouter;
