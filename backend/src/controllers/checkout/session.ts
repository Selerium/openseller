import crypto from "node:crypto";
import express from "express";
import validator from "validator";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { config } from "../../lib/config.ts";
import { effectivePrice } from "../../lib/catalog.ts";
import { parseAddressInput, type AddressSnapshot } from "../../lib/address.ts";
import { stripeClient, stripeConfigured } from "../../lib/stripe.ts";
import { ensureStripeCustomer } from "../../lib/stripeCustomer.ts";

/**
 * Creating a Checkout Session.
 *
 * The order is written *before* Stripe is called, as PENDING_PAYMENT. The alternative — create
 * the session first and write the order from the webhook — leaves a window where the customer
 * has been charged and the order does not exist yet, which is the worst possible failure to
 * reconcile by hand. The webhook then moves PENDING_PAYMENT -> PAID.
 *
 * The cost of this ordering is abandoned checkouts leaving PENDING_PAYMENT rows behind, which
 * `cancelSupersededCheckouts` below cleans up the next time this shopper checks out: the new
 * attempt is itself the proof the old one was given up on.
 */
const checkoutRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINES = 100;
const MAX_QUANTITY = 99;

/** Shipping and tax are fixed at zero for now; the columns exist so neither is a schema change later. */
const SHIPPING_CENTS = 0;
const TAX_CENTS = 0;

interface RequestedLine {
  variantId: string;
  quantity: number;
}

/**
 * Validate the cart as submitted.
 *
 * Prices are deliberately absent from the accepted shape: they are re-read from the database
 * below. A client that could name its own price would not be a store.
 */
function parseRequestedItems(value: unknown): RequestedLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError("Your cart is empty", 400);
  }
  if (value.length > MAX_LINES) {
    throw new AppError(`An order is limited to ${MAX_LINES} lines`, 400);
  }

  const lines: RequestedLine[] = [];

  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      throw new AppError("Invalid cart line", 400);
    }
    const { variantId, quantity } = raw as Record<string, unknown>;

    if (typeof variantId !== "string" || !UUID.test(variantId)) {
      throw new AppError("Invalid cart line", 400);
    }

    const qty = typeof quantity === "number" ? quantity : Number(quantity);
    // Number.isInteger and not a bare `> 0`: 1.5 items, NaN and Infinity all have to be refused
    // here rather than reaching Postgres as a numeric that no longer means a count.
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) {
      throw new AppError(`Quantity must be a whole number between 1 and ${MAX_QUANTITY}`, 400);
    }

    // Merge duplicate lines for the same variant instead of rejecting them. The cart keys on
    // variantId so this cannot happen from our own UI, but two of the same product arriving via
    // different tabs used to be silently summed by the stock decrement while creating two
    // separate order lines.
    const existing = lines.find((line) => line.variantId === variantId);
    if (existing) {
      existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + qty);
    } else {
      lines.push({ variantId, quantity: qty });
    }
  }

  return lines;
}

/** sha256, for the guest order token. The raw token is handed to the client exactly once. */
function newGuestToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  return { raw, hash: crypto.createHash("sha256").update(raw).digest("hex") };
}

/**
 * Cancel this buyer's earlier checkouts when they start a new one.
 *
 * Submitting the checkout form again is the strongest signal a shopper can give that the order
 * they walked away from is never going to be paid — same buyer, same basket, fresh attempt — so
 * the previous PENDING_PAYMENT row is cancelled right there. An age bound used to guard this
 * sweep, and it is what left the real-world bug standing: a shopper who abandoned Checkout and
 * re-checked-out twenty seconds later still saw the abandoned attempt in My orders reading
 * "Pending payment", which reads as a bug even though nothing had gone wrong yet.
 *
 * Scoped to the buyer, so one shopper's attempt never cancels another's, and only to rows with
 * no payment against them, so a real order is never touched. It does mean a shopper who starts
 * a second checkout and then pays the *first* session hits markOrderPaid's 409 — the same
 * accepted trade-off the age-bounded sweep had, and for the same reason: either way they chose
 * to leave that session behind.
 */
async function cancelSupersededCheckouts(
  profileId: string | null,
  guestEmail: string | null,
): Promise<void> {
  const owner =
    profileId !== null
      ? { profileId }
      : guestEmail !== null
        ? { profileId: null, guestEmail }
        : null;
  if (!owner) return;

  await prisma.order.updateMany({
    where: {
      ...owner,
      status: "PENDING_PAYMENT",
      payment: "UNPAID",
    },
    data: { status: "CANCELLED" },
  });
}

checkoutRouter.post("/session", async (req, res) => {
  const profileId = req.user?.id ?? null;
  const requested = parseRequestedItems(req.body?.items);

  // --- who is buying ---
  const accountEmail = profileId
    ? (
        await prisma.profile.findUnique({
          where: { id: profileId },
          select: { user: { select: { email: true } } },
        })
      )?.user.email ?? null
    : null;
  // A guest has no account to fall back on, so an email is mandatory for them: it is how the
  // order is delivered, how a complaint is attributed, and how the order is later adopted if
  // they sign up.
  const requestedEmail =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : null;
  const email = accountEmail ?? requestedEmail;
  if (!email || !validator.isEmail(email)) {
    throw new AppError("A valid email address is required to check out", 400);
  }

  const shippingAddress: AddressSnapshot = parseAddressInput(req.body?.shippingAddress);
  const billingAddress: AddressSnapshot | null =
    req.body?.billingAddress === undefined || req.body?.billingAddress === null
      ? null
      : parseAddressInput(req.body.billingAddress);

  // --- price the cart from the database ---
  const variants = await prisma.variant.findMany({
    where: { id: { in: requested.map((line) => line.variantId) } },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          deletedAt: true,
          discountPercent: true,
          images: {
            orderBy: { position: "asc" },
            take: 1,
            select: { url: true },
          },
        },
      },
    },
  });

  if (variants.length !== requested.length) {
    throw new AppError("Your cart contains an item that no longer exists", 409);
  }

  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const pricedLines = requested.map((line) => {
    const variant = byId.get(line.variantId)!;

    // A variant whose product was archived or deleted since it was added to the cart is treated
    // as gone rather than silently orderable.
    if (variant.product.deletedAt !== null || variant.product.status !== "ACTIVE") {
      throw new AppError(`"${variant.product.title}" is no longer available`, 409);
    }

    // Refuse oversell at the point of payment rather than after it. Stock is only decremented on
    // the webhook, so this is a courtesy check that can still be beaten by a race; the webhook
    // tolerates going negative instead of failing a payment that already succeeded.
    if (variant.stock < line.quantity) {
      throw new AppError(
        variant.stock === 0
          ? `"${variant.product.title}" is out of stock`
          : `Only ${variant.stock} of "${variant.product.title}" left`,
        409,
      );
    }

    // The same helper the storefront card and detail page used, so checkout agrees with the
    // advertised price to the cent.
    const unitPriceCents = effectivePrice(
      variant.priceCents,
      variant.product.discountPercent,
    );

    return {
      variantId: variant.id,
      productId: variant.product.id,
      title: variant.product.title,
      variantName: variant.name,
      sku: variant.sku,
      unitPriceCents,
      quantity: line.quantity,
      imageUrl: variant.product.images[0]?.url ?? null,
    };
  });

  const subtotalCents = pricedLines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  );
  const totalCents = subtotalCents + SHIPPING_CENTS + TAX_CENTS;

  // A 100%-off product makes a legitimate order total 0. Free orders are refused rather than
  // sent to Stripe, which rejects a zero-amount payment session anyway, and the refund story for
  // "paid nothing" is not worth the special cases.
  if (totalCents <= 0) {
    throw new AppError("This order has a total of 0 and cannot be paid", 409);
  }

  await cancelSupersededCheckouts(profileId, accountEmail ? null : email);

  const guest = profileId === null ? newGuestToken() : null;

  const order = await prisma.order.create({
    data: {
      profileId,
      guestEmail: profileId === null ? email : null,
      guestTokenHash: guest?.hash ?? null,
      status: "PENDING_PAYMENT",
      payment: "UNPAID",
      currency: config.currency,
      subtotalCents,
      shippingCents: SHIPPING_CENTS,
      taxCents: TAX_CENTS,
      totalCents,
      shippingAddress: shippingAddress as unknown as object,
      billingAddress: billingAddress as unknown as object,
      items: { create: pricedLines },
      events: {
        create: {
          type: "order.created",
          note: `Order placed for ${email}`,
        },
      },
    },
    select: { id: true, number: true, totalCents: true },
  });

  // --- pay ---
  //
  // Mock mode short-circuits before Stripe is contacted. It is only reachable when
  // ALLOW_MOCK_PAYMENTS=true, which lib/config.ts refuses outright when PROD=true.
  if (!stripeConfigured()) {
    if (!config.allowMockPayments) {
      // Nothing was charged, so the order must not be left looking payable. Cancelling it keeps
      // the admin order list free of "customer started checkout" noise.
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });
      throw new AppError(
        "Payments are not configured on this server (STRIPE_SECRET_KEY is unset)",
        503,
      );
    }

    res.status(201).json({
      data: {
        orderId: order.id,
        orderNumber: order.number,
        totalCents: order.totalCents,
        currency: config.currency,
        mock: true,
        // The guest token is returned here exactly as it is on the Stripe path. In mock mode
        // there is no Stripe dashboard to fall back on, so this is the guest's only route to
        // their order.
        guestToken: guest?.raw ?? null,
        // Same shape as the Stripe redirect, so the success page has one code path. The mock
        // confirm step is what stands in for the payment page.
        redirectUrl: `/checkout/mock-pay/${order.id}`,
      },
      error: false,
      message: "Mock order created. Confirm it to complete the mock payment.",
    });
    return;
  }

  try {
    // Give Stripe the Customer we already hold for a signed-in shopper, rather than the bare
    // email. This is the only thing that makes the cards saved on /profile/payment-methods
    // usable: Checkout can only offer a saved card when it knows which customer to look under.
    //
    // customer and customer_email are mutually exclusive in Stripe's API — passing both is
    // rejected — hence the branch. Guests have no Customer and keep the email path, where
    // Stripe matches or creates one from the address.
    //
    // Created here rather than only in the saved-cards flow so a shopper who checks out first
    // still ends up with exactly one Customer. Otherwise the first card save would mint a
    // second customer for the same email and the two would never see each other again.
    const customerId = profileId ? await ensureStripeCustomer(profileId) : null;

    const session = await stripeClient().checkout.sessions.create({
      mode: "payment",
      line_items: pricedLines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency: config.currency,
          unit_amount: line.unitPriceCents,
          product_data: {
            // The variant name is part of the line's identity to the customer: two sizes of one
            // product are two line items on the Stripe receipt, not one.
            name: `${line.title}${line.variantName === "Default" ? "" : ` — ${line.variantName}`}`,
          },
        },
      })),
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      // client_reference_id is what a human sees in the Stripe dashboard, metadata.orderId is
      // what the webhook reads. Both are set because they fail in different ways: a dashboard
      // with no reference is hard to support, and a webhook with no id cannot find the order.
      client_reference_id: order.id,
      metadata: { orderId: order.id },
      // setup_future_usage is deliberately absent. It would make Stripe keep every card the
      // shopper types into the hosted page for future off-session charges, which is a consent
      // decision and not one to make silently. Cards are saved when the shopper saves them,
      // explicitly, on /profile/payment-methods.
      payment_intent_data: { metadata: { orderId: order.id } },
      success_url: `${config.storeUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      // The order id rides along so the cancelled page can cancel it (POST /checkout/cancel).
      // Stripe's redirect back here is the moment the shopper declares this attempt dead, and
      // without an id the page has no way to say which order died with it.
      cancel_url: `${config.storeUrl}/checkout/cancelled?order=${order.id}`,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    res.status(201).json({
      data: {
        orderId: order.id,
        orderNumber: order.number,
        totalCents: order.totalCents,
        currency: config.currency,
        mock: false,
        // The token is returned once, here, and never again. A guest who loses it loses access
        // to the order until they sign in and have it adopted on their verified email.
        guestToken: guest?.raw ?? null,
        redirectUrl: session.url,
      },
      error: false,
      message: "",
    });
  } catch (error) {
    // Stripe rejected the session, so no payment exists. Leaving a PENDING_PAYMENT row would
    // imply a customer is mid-payment when nobody is.
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });
    throw error;
  }
});

export default checkoutRouter;