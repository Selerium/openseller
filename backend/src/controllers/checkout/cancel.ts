import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { ok } from "../../lib/http.ts";
import { callerOwnsOrder } from "../../lib/orders.ts";

/**
 * Cancel the order when the shopper walks away from Stripe Checkout.
 *
 * Stripe redirects to /checkout/cancelled when the customer gives up, but the redirect alone
 * changes nothing on our side: the order stays PENDING_PAYMENT and sits in My orders reading
 * "Pending payment" — an order the shopper considers cancelled. The cancelled page closes the
 * loop from there, naming the order it was sent back with (see cancel_url in session.ts).
 *
 * This is the mirror image of confirm.ts in every way that matters: the id is only used to
 * *find* the row, ownership is proved with callerOwnsOrder (session, guest token, or the
 * verified email that matches the guest address), and a request that cannot prove either is
 * answered 404 rather than 403 — whether some other shopper's order exists is itself a leak.
 *
 * Everything already resolved (paid, cancelled by the supersede sweep first) is a 200 no-op
 * rather than an error. The page behind this endpoint is best-effort and may be retried, and a
 * shopper who cancelled twice has still cancelled.
 */
const cancelRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

cancelRouter.post("", async (req, res) => {
  const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
  if (!UUID.test(orderId)) {
    throw new AppError("An order id is required", 400);
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("Order not found", 404);

  const owns = await callerOwnsOrder(order, {
    userId: req.user?.id ?? null,
    guestToken: req.get("x-guest-token") ?? null,
  });
  if (!owns) throw new AppError("Order not found", 404);

  if (order.status !== "PENDING_PAYMENT" || order.payment !== "UNPAID") {
    return ok(
      res,
      { orderId: order.id, status: order.status, payment: order.payment },
      order.status === "CANCELLED" ? "Order is already cancelled" : "Order is not awaiting payment",
    );
  }

  // Status and its timeline entry land together, same rule as the admin status endpoint: a
  // cancelled order whose timeline never says who cancelled it is a support question later.
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "status.changed",
        note: "Checkout cancelled by the customer",
      },
    });
    return next;
  });

  ok(
    res,
    { orderId: updated.id, status: updated.status, payment: updated.payment },
    "Order cancelled",
  );
});

export default cancelRouter;
