/**
 * Creates one throwaway guest order in a chosen state, for the orders suite.
 *
 * Run inside the backend container, from the host: `make test-order mode=paid`.
 *
 * Why not POST /checkout/session: that only ever produces PENDING_PAYMENT/UNPAID, and the
 * states an admin actions suite needs — already paid, already delivered, already refunded —
 * cannot be reached over HTTP without making a real Stripe charge. Writing the row directly
 * is exactly what this helper is for, in the same spirit as make-account.ts.
 *
 * The guest token is printed so the suite can prove ownership over HTTP, exactly as if the
 * order had come out of a real checkout. Cleanup is test/sweep.ts's job: guest orders with a
 * `orders.*@openseller.test` address are removed before every `make test` run.
 */
import crypto from "node:crypto";
import { prisma } from "../src/lib/prismaClient.ts";
import { effectivePrice } from "../src/lib/catalog.ts";

const mode = process.argv[2] || "pending";
// Optional third argument: a Stripe checkout session id to attach. The confirm suite uses this
// for an owned order whose session Stripe does not know about (the 502 path).
const sessionId = process.argv[3] || null;

const MODES: Record<
  string,
  { status: string; payment: string; events: { type: string; note: string }[] }
> = {
  pending: {
    status: "PENDING_PAYMENT",
    payment: "UNPAID",
    events: [],
  },
  paid: {
    status: "PAID",
    payment: "PAID",
    events: [{ type: "payment.succeeded", note: "Payment captured (test)" }],
  },
  fulfilled: {
    status: "FULFILLED",
    payment: "PAID",
    events: [
      { type: "payment.succeeded", note: "Payment captured (test)" },
      { type: "status.changed", note: "Marked as delivered" },
    ],
  },
  refunded: {
    status: "REFUNDED",
    payment: "REFUNDED",
    events: [
      { type: "payment.succeeded", note: "Payment captured (test)" },
      { type: "status.changed", note: "Order refunded" },
    ],
  },
  cancelled: {
    status: "CANCELLED",
    payment: "UNPAID",
    events: [{ type: "status.changed", note: "Order cancelled" }],
  },
};

if (!MODES[mode]) {
  console.error(`usage: node test/make-order.ts <${Object.keys(MODES).join("|")}>`);
  process.exit(1);
}

const email = `orders.${mode}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@openseller.test`;
const rawToken = crypto.randomBytes(32).toString("hex");
const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

// A real, currently-live variant gives the order a realistic line without hard-coding a seed
// id that a reseed could invalidate. Falls back to an empty order if the catalog is empty.
const variant = await prisma.variant.findFirst({
  where: { product: { status: "ACTIVE", deletedAt: null } },
  include: {
    product: {
      select: {
        title: true,
        discountPercent: true,
        images: { take: 1, orderBy: { position: "asc" } },
      },
    },
  },
});

const unitPriceCents = variant
  ? effectivePrice(variant.priceCents, variant.product.discountPercent)
  : 1000;

const order = await prisma.order.create({
  data: {
    guestEmail: email,
    guestTokenHash: tokenHash,
    status: MODES[mode].status as never,
    payment: MODES[mode].payment as never,
    currency: "usd",
    subtotalCents: unitPriceCents,
    shippingCents: 0,
    taxCents: 0,
    totalCents: unitPriceCents,
    shippingAddress: {
      name: "Throwaway Shopper",
      line1: "1 Test Way",
      city: "Testville",
      zip: "00000",
      country: "US",
    },
    ...(sessionId ? { stripeCheckoutSessionId: sessionId } : {}),
    items: variant
      ? {
          create: [
            {
              variantId: variant.id,
              productId: variant.productId,
              title: variant.product.title,
              variantName: variant.name === "Default" ? null : variant.name,
              sku: variant.sku,
              unitPriceCents,
              quantity: 1,
              imageUrl: variant.product.images[0]?.url ?? null,
            },
          ],
        }
      : undefined,
    events: {
      create: [
        { type: "order.created", note: `Order placed for ${email}` },
        ...MODES[mode].events,
      ],
    },
  },
  select: { id: true, number: true },
});

console.log(JSON.stringify({ id: order.id, number: order.number, email, token: rawToken, mode }));

await prisma.$disconnect();