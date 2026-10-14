import crypto from "node:crypto";
import AppError from "./appError.ts";
import { prisma } from "./prismaClient.ts";
import { recomputeProductRollup } from "./catalog.ts";
import { sendOrderConfirmation } from "./email.ts";
import { notify } from "./notify.ts";

/**
 * Is this caller the buyer of `order`?
 *
 * Three proofs, all facts the database already holds:
 *
 *   1. The order's own profile, presented as the session's access token.
 *   2. The one-time guest token handed back when the order was created. Only its sha256 is
 *      stored, so this is a digest comparison and a database leak yields nothing usable.
 *   3. A *verified* account whose address matches the guest email. Checkout runs ahead of the
 *      auth guard, so `req.user` is absent there and almost every order — including one placed
 *      by a signed-in shopper — is written with profileId null and the buyer's email as
 *      guestEmail. This is the same rule claimGuestOrders uses to adopt those orders afterwards,
 *      and it is only satisfiable by someone who has proven control of the mailbox.
 *
 * Shared by the two ways an unpaid order can be confirmed (the mock payment and the reconcile
 * after Stripe Checkout) so they cannot drift into two different ideas of "the buyer".
 */
export async function callerOwnsOrder(
  order: {
    profileId: string | null;
    guestEmail: string | null;
    guestTokenHash: string | null;
  },
  caller: { userId?: string | null; guestToken?: string | null },
): Promise<boolean> {
  if (caller.userId && order.profileId === caller.userId) return true;

  if (caller.guestToken && order.guestTokenHash) {
    const digest = crypto.createHash("sha256").update(caller.guestToken).digest("hex");
    if (digest === order.guestTokenHash) return true;
  }

  if (!caller.userId || !order.guestEmail) return false;

  const profile = await prisma.profile.findUnique({
    where: { id: caller.userId },
    select: { user: { select: { email: true, emailVerified: true } } },
  });

  return Boolean(
    profile?.user.emailVerified &&
      profile.user.email.toLowerCase() === order.guestEmail.toLowerCase(),
  );
}

/**
 * Move an order to PAID and take the stock out of inventory.
 *
 * Shared by the Stripe webhook and the local mock-payment confirm, because "a payment
 * succeeded" is one business fact and two implementations of it would drift: the mock path
 * would pass its tests while the real one decremented stock in the wrong order or skipped the
 * rollup.
 *
 * Idempotent by design. Stripe retries webhooks, and a retried delivery must not decrement
 * stock twice, so a second call on an already-PAID order returns without touching anything.
 */
export async function markOrderPaid(
  orderId: string,
  options: { stripePaymentIntentId?: string | null } = {},
): Promise<{ orderId: string; number: number; email: string; totalCents: number; currency: string; alreadyPaid: boolean }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new AppError("Order not found", 404);

  // Already paid: nothing to do. Deliberately not an error, so a webhook retry answers 200 and
  // Stripe stops redelivering.
  if (order.payment === "PAID") {
    const email = order.guestEmail ?? "";
    return {
      orderId: order.id,
      number: order.number,
      email,
      totalCents: order.totalCents,
      currency: order.currency,
      alreadyPaid: true,
    };
  }

  // A cancelled or refunded order must not be resurrected by a late webhook. This is reachable
  // if someone pays a session that was superseded by cancelSupersededCheckouts after the fact.
  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    throw new AppError(`Order is ${order.status.toLowerCase()} and cannot be paid`, 409);
  }

  const productIds = new Set<string>();

  // Stock, status and the timeline entry land together. If any part fails the order is left
  // PENDING_PAYMENT and a retry can try again, rather than being left paid with inventory that
  // was never taken.
  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      // OrderItem.variantId is nullable and is not a foreign key, so the variant may since have
      // been deleted. A deleted variant has no stock to take, and failing the payment over it
      // would strand the customer's money.
      if (!item.variantId) continue;

      const variant = await tx.variant.findUnique({
        where: { id: item.variantId },
        select: { id: true, productId: true, stock: true },
      });
      if (!variant) continue;

      const next = variant.stock - item.quantity;
      if (next < 0) {
        // Logged rather than rejected: the payment has already succeeded, and refusing to record
        // it would leave a paid order looking unpaid. Overselling is an accepted v1 risk (see
        // the plan) and an admin resolves it from the low-stock report.
        console.warn(
          `Oversell on ${item.title}: stock was ${variant.stock}, ${item.quantity} sold. ` +
            `Stock is now ${next}.`,
        );
      }

      await tx.variant.update({
        where: { id: variant.id },
        data: { stock: next },
      });
      productIds.add(variant.productId);
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        payment: "PAID",
        ...(options.stripePaymentIntentId
          ? { stripePaymentIntentId: options.stripePaymentIntentId }
          : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "payment.succeeded",
        note: options.stripePaymentIntentId
          ? `Payment captured (${options.stripePaymentIntentId})`
          : "Payment captured",
      },
    });
  });

  // Product.minPriceCents / stockTotal / salePriceCents are denormalised for the storefront
  // grid, so they have to follow the stock write. Inside the same transaction as the decrement:
  // a crash between the two would leave the marketplace advertising stock that is already gone.
  for (const productId of productIds) {
    await recomputeProductRollup(productId);
  }

  // Resolve the recipient only after the commit, and never let a mail failure undo the payment.
  const recipient = await resolveRecipient(order.profileId, order.guestEmail);

  // Same rule as the confirmation email below: the inbox row must never undo the payment,
  // so it is written after the commit and never awaited to success.
  if (order.profileId) {
    void notify(order.profileId, {
      type: "order.paid",
      title: `Payment confirmed for order #${order.number}`,
      body: "Your payment went through — thanks for shopping with us.",
      link: `/profile/orders/${order.id}`,
    }).catch(() => {});
  }

  return {
    orderId: order.id,
    number: order.number,
    email: recipient,
    totalCents: order.totalCents,
    currency: order.currency,
    alreadyPaid: false,
  };
}

async function resolveRecipient(
  profileId: string | null,
  guestEmail: string | null,
): Promise<string> {
  if (guestEmail) return guestEmail;
  if (!profileId) return "";

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { user: { select: { email: true } } },
  });
  return profile?.user.email ?? "";
}

/**
 * Fire the confirmation email for a paid order.
 *
 * Called after `markOrderPaid` and deliberately outside it: a mail provider outage must not turn
 * into a failed payment. Failures are logged, never thrown.
 */
export async function sendPaidOrderConfirmation(order: {
  orderId: string;
  number: number;
  email: string;
  totalCents: number;
  currency: string;
  alreadyPaid: boolean;
}): Promise<void> {
  // Nothing to send to, and nothing useful to send to a non-existent address.
  if (!order.email) return;
  // A retry already sent it on the first delivery.
  if (order.alreadyPaid) return;

  const lines = await prisma.orderItem.findMany({
    where: { orderId: order.orderId },
    orderBy: { title: "asc" },
  });

  try {
    await sendOrderConfirmation(order.email, {
      orderNumber: order.number,
      totalCents: order.totalCents,
      currency: order.currency,
      lines: lines.map((line) => ({
        title: line.title,
        variantName: line.variantName,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
    });
  } catch (error) {
    console.error(`Order ${order.number} paid but the confirmation email failed:`, error);
  }
}