import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { config } from "../../lib/config.ts";
import { callerOwnsOrder, markOrderPaid, sendPaidOrderConfirmation } from "../../lib/orders.ts";

/**
 * The local stand-in for Stripe's payment page.
 *
 * Exists only when ALLOW_MOCK_PAYMENTS is true, which lib/config.ts refuses when PROD=true.
 * It calls the exact same markOrderPaid the webhook calls, so an order paid through here is
 * indistinguishable downstream from one paid through Stripe: same status, same stock
 * decrement, same timeline, same email.
 */
const mockPayRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

mockPayRouter.post("/:orderId", async (req, res) => {
  if (!config.allowMockPayments) {
    throw new AppError("Not found", 404);
  }

  const { orderId } = req.params;
  if (!UUID.test(orderId)) throw new AppError("Order not found", 404);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("Order not found", 404);

  // The caller must be the buyer. A session works for the order's own profile; a guest works
  // with the one-time token handed back when the order was created. Without this, anyone could
  // confirm anybody else's unpaid order and have the stock released to them.
  const owns = await callerOwnsOrder(order, {
    userId: req.user?.id ?? null,
    guestToken: req.get("x-guest-token") ?? null,
  });
  if (!owns) throw new AppError("Order not found", 404);

  const paid = await markOrderPaid(orderId, {});
  await sendPaidOrderConfirmation(paid);

  res.status(200).json({
    data: {
      orderId: paid.orderId,
      orderNumber: paid.number,
      totalCents: paid.totalCents,
      currency: paid.currency,
      alreadyPaid: paid.alreadyPaid,
    },
    error: false,
    message: paid.alreadyPaid ? "Order was already paid" : "Mock payment completed",
  });
});

export default mockPayRouter;