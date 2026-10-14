import type { Stripe } from "stripe";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { constructWebhookEvent } from "../../lib/stripe.ts";
import { markOrderPaid, sendPaidOrderConfirmation } from "../../lib/orders.ts";

/**
 * Stripe webhook.
 *
 * This is the only thing in the codebase that marks an order paid *without asking Stripe first*:
 * a signed `checkout.session.completed` is proof on its own, so the browser returning from
 * Checkout is never taken at its word and nothing on the success page writes order status.
 *
 * It is no longer the only route to PAID, though. When no webhook endpoint is configured — a
 * self-hosted box with no public URL, or STRIPE_WEBHOOK_SECRET left unset — checkout/confirm.ts
 * reconciles the session by asking Stripe directly from the server. Both run through the same
 * idempotent markOrderPaid, so whichever arrives first records the payment and the other is a
 * no-op answering 200.
 *
 * Mounted before express.json() with its own raw parser, because the signature is computed over
 * the exact bytes Stripe signed and re-serialising a parsed object is not guaranteed to
 * reproduce them.
 */
const webhookHandler = async (req, res) => {
  const signature = req.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(req.body as Buffer, signature);
  } catch (error) {
    // An unverified payload is never acted on, and the response deliberately does not say
    // whether the signature or the body was the problem.
    if (error instanceof AppError) throw error;
    throw new AppError("Webhook signature verification failed", 400);
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;

      // For card payments payment_status is already "paid" here. For delayed methods it is
      // "unpaid" at this point, which is why async_payment_succeeded is handled too. Anything
      // else (including a failed method) is acknowledged and ignored: the order stays
      // PENDING_PAYMENT, and Stripe will tell us separately if it never resolves.
      if (session.payment_status !== "paid") break;

      // metadata.orderId is authoritative. client_reference_id is the human-facing copy and is
      // kept as a fallback for sessions created before the metadata existed.
      const orderId =
        session.metadata?.orderId ?? session.client_reference_id ?? null;
      if (!orderId) break;

      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      const paid = await markOrderPaid(orderId, {
        stripePaymentIntentId: paymentIntentId,
      });
      await sendPaidOrderConfirmation(paid);
      break;
    }

    // A failed or expired session means the order will never be paid. Marking it cancelled is
    // what keeps abandoned carts out of the admin order list.
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId ?? session.client_reference_id ?? null;
      if (!orderId) break;

      // Guarded on payment = UNPAID rather than fetched and re-checked, so an expiry that
      // races a successful payment cannot cancel money that was actually taken.
      await prisma.order.updateMany({
        where: { id: orderId, payment: "UNPAID" },
        data: { status: "CANCELLED" },
      });
      break;
    }

    default:
      // Every other event type is acknowledged with a 200 so Stripe does not retry something we
      // have never heard of. Handled types live in the switch above.
      break;
  }

  res.status(200).json({ received: true });
};

export default webhookHandler;