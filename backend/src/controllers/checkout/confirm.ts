import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { ok } from "../../lib/http.ts";
import { stripeClient, stripeConfigured } from "../../lib/stripe.ts";
import {
  callerOwnsOrder,
  markOrderPaid,
  sendPaidOrderConfirmation,
} from "../../lib/orders.ts";

/**
 * Reconcile the payment when the browser comes back from Stripe Checkout.
 *
 * Stripe's signed webhook is what normally moves an order to PAID, but a webhook only arrives
 * if the deployment has a public URL *and* STRIPE_WEBHOOK_SECRET set to the matching endpoint
 * secret. On a self-hosted box with neither, the customer pays, lands on /checkout/success and
 * then watches their order sit at "pending payment / unpaid" forever — which is exactly the bug
 * this endpoint exists for. The same hole appears whenever Stripe delivers late or drops an
 * event.
 *
 * So the success page asks the server to look again, and the server asks Stripe directly. This
 * is not the browser vouching for itself: `session_id` is only used to *find* the session, and
 * the decision to mark the order paid is made from `checkout.sessions.retrieve`, which is the
 * same authoritative source a webhook reads. Both paths run through the same idempotent
 * markOrderPaid, so whichever arrives first wins and the other one is a no-op.
 *
 * Reads the session rather than the payment intent because Checkout can be paid by methods
 * whose intent is still confirming; `payment_status` is the field that means "money taken".
 */
const confirmRouter = express.Router();

// Stripe ids are long base62-ish strings; the shape check keeps junk out of the lookup below
// and out of the Stripe API call.
const SESSION_ID = /^cs_[A-Za-z0-9_]+$/;

confirmRouter.post("", async (req, res) => {
  const sessionId =
    typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  if (!SESSION_ID.test(sessionId)) {
    throw new AppError("A Stripe checkout session id is required", 400);
  }

  const order = await prisma.order.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
  });
  // Answered with 404 rather than 403 for the same reason as everywhere else here: confirming
  // that some other shopper's checkout session exists is itself a leak.
  if (!order) throw new AppError("Order not found", 404);

  const owns = await callerOwnsOrder(order, {
    userId: req.user?.id ?? null,
    guestToken: req.get("x-guest-token") ?? null,
  });
  if (!owns) throw new AppError("Order not found", 404);

  if (!stripeConfigured()) {
    throw new AppError(
      "Payments are not configured on this server (STRIPE_SECRET_KEY is unset)",
      503,
    );
  }

  let session;
  try {
    session = await stripeClient().checkout.sessions.retrieve(sessionId);
  } catch (error) {
    // Distinguished from "not paid" on purpose: an unreachable Stripe must not be reported to
    // the customer as a payment that did not happen. The order keeps its current status and
    // the webhook, if one is configured, still settles it.
    console.error(`Could not retrieve ${sessionId} to confirm payment:`, error);
    throw new AppError("Could not verify the payment with Stripe", 502);
  }

  // The row was found by this very session id, so a disagreement means the metadata was
  // rewritten after the session was created. Refusing is cheaper than reconciling by hand.
  if (session.metadata?.orderId && session.metadata.orderId !== order.id) {
    throw new AppError("This checkout session belongs to a different order", 409);
  }

  if (session.payment_status !== "paid") {
    // Nothing has been captured (or it is still confirming). Say so plainly and change
    // nothing: the webhook may still land, and inventing a status here would be worse than
    // the delay.
    return ok(
      res,
      {
        orderId: order.id,
        orderNumber: order.number,
        status: order.status,
        payment: order.payment,
        paid: false,
        alreadyPaid: false,
      },
      "The payment has not been confirmed yet",
    );
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  const paid = await markOrderPaid(order.id, { stripePaymentIntentId: paymentIntentId });
  await sendPaidOrderConfirmation(paid);

  const fresh = await prisma.order.findUnique({
    where: { id: order.id },
    select: { id: true, number: true, status: true, payment: true },
  });

  ok(
    res,
    {
      orderId: fresh?.id ?? order.id,
      orderNumber: fresh?.number ?? order.number,
      status: fresh?.status ?? order.status,
      payment: fresh?.payment ?? order.payment,
      paid: true,
      alreadyPaid: paid.alreadyPaid,
    },
    paid.alreadyPaid ? "Order was already paid" : "Payment confirmed",
  );
});

export default confirmRouter;
