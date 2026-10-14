import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import { stripeClient } from "../../lib/stripe.ts";
import { ensureStripeCustomer } from "../../lib/stripeCustomer.ts";
import { config } from "../../lib/config.ts";
import { ok } from "../../lib/http.ts";
import AppError from "../../lib/appError.ts";

const paymentMethodsRouter = express.Router();

/**
 * The shopper's saved cards. Mounted under /account/payment-methods with checkTokens, so
 * req.user.id is the Profile id and every query is scoped by it.
 *
 * Only display metadata is stored here — brand, last4, expiry. Card numbers never touch this
 * database; they go from the browser's Stripe Element straight to Stripe, and what lands in
 * PaymentMethod is the description of a card that already exists on Stripe's side.
 */

/** Throws unless the caller owns this profile, so a wrong-owner id reads as a missing id. */
async function requireOwnedMethod(id: string, profileId: string) {
  const method = await prisma.paymentMethod.findFirst({ where: { id, profileId } });
  if (!method) throw new AppError("Payment method not found", 404);
  return method;
}

/**
 * Cards are shown from our own row, not from Stripe.
 *
 * Stripe remains the authority on what a card actually is, but it is a network call per render
 * and it will not answer at all when the key is unset — a payment page that 500s in local dev
 * for want of an environment variable is worse than one that shows the last known expiry. The
 * stored copy is written at attach time from the Stripe response and only changes when a card is
 * replaced, so it cannot silently drift.
 */
function toResponse(method: {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  createdAt: Date;
}) {
  return {
    id: method.id,
    brand: method.brand,
    last4: method.last4,
    expMonth: method.expMonth,
    expYear: method.expYear,
    isDefault: method.isDefault,
    createdAt: method.createdAt,
  };
}

/**
 * GET /account/payment-methods/config
 *
 * The publishable key, for the Element. Served from here rather than compiled into the
 * frontend, and it reports `configured` separately so the page can say why it is unusable
 * instead of failing inside loadStripe().
 */
paymentMethodsRouter.get("/config", async (_req, res) => {
  ok(res, {
    publishableKey: config.stripePublishableKey,
    configured: Boolean(config.stripeSecretKey && config.stripePublishableKey),
  });
});

/** GET /account/payment-methods */
paymentMethodsRouter.get("", async (req, res) => {
  const methods = await prisma.paymentMethod.findMany({
    where: { profileId: req.user.id },
    // Default first, then newest. A shopper with several cards should never have to hunt for
    // the one that will actually be charged.
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  ok(res, methods.map(toResponse));
});

/**
 * POST /account/payment-methods/setup-intent
 *
 * Starts the save. Returns a client secret for the browser's Element to confirm; the card is
 * not stored until the client posts it back to /attach below.
 *
 * No currency is stated, for the same reason the API refuses one: SetupIntents do not take a
 * currency parameter. The card is attached to the Customer, not to a currency, and the
 * PaymentIntent that later charges it names its own currency at charge time. Pinning a currency
 * here was an attempt to "align" SetupIntent and checkout, and Stripe rejects it — which is
 * itself the answer: there is no alignment to do.
 */
paymentMethodsRouter.post("/setup-intent", async (req, res) => {
  const customerId = await ensureStripeCustomer(req.user.id);

  const setupIntent = await stripeClient().setupIntents.create({
    customer: customerId,
    usage: "off_session",
  });

  ok(res, {
    setupIntentId: setupIntent.id,
    clientSecret: setupIntent.client_secret,
  });
});

/**
 * POST /account/payment-methods/attach
 *
 * Finishes the save with the SetupIntent the browser confirmed.
 *
 * The customer is re-read from the profile and compared against the intent's own, because
 * setup_intent.customer is client-influenced: without that check a shopper could confirm an
 * intent raised against somebody else's customer and attach their card to that customer.
 */
paymentMethodsRouter.post("/attach", async (req, res) => {
  const setupIntentId = typeof req.body?.setupIntentId === "string" ? req.body.setupIntentId : "";
  if (!setupIntentId) throw new AppError("setupIntentId is required", 400);

  const stripe = stripeClient();
  const intent = await stripe.setupIntents.retrieve(setupIntentId);

  const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  if (!customerId) throw new AppError("Setup intent is not attached to a customer", 400);

  const profile = await prisma.profile.findUnique({ where: { id: req.user.id } });
  if (!profile) throw new AppError("Profile not found", 404);
  if (profile.stripeCustomerId !== customerId) {
    throw new AppError("Setup intent does not belong to this account", 403);
  }

  // The intent must already be confirmed, because only the browser ever saw the card.
  //
  // There is deliberately no server-side confirm() fallback here. Confirming on the shopper's
  // behalf is impossible — the payment method lives in the Element iframe and has not been sent
  // to us — so a confirm() call would only ever fail, and would fail with a Stripe error rather
  // than anything the shopper could act on.
  if (intent.status !== "succeeded") {
    throw new AppError(
      "That card was not confirmed. Please enter it again and save it once more.",
      400,
    );
  }

  const pmId = intent.payment_method;
  const stripeMethodId = typeof pmId === "string" ? pmId : pmId?.id;
  if (!stripeMethodId) throw new AppError("Setup intent completed without a payment method", 400);

  const method = await stripe.paymentMethods.retrieve(stripeMethodId);
  const card = method.card;
  if (!card) throw new AppError("Only card payments can be saved", 400);

  // The first card becomes the default, same rule as a first address: otherwise a shopper
  // saves their only card and checkout still finds no default to charge.
  const isFirst = (await prisma.paymentMethod.count({ where: { profileId: req.user.id } })) === 0;

  const saved = await prisma.$transaction(async (tx) => {
    // Re-adding a card already on file (a retry, or the same card twice) updates the existing
    // row instead of failing on the unique stripePaymentMethodId and leaving the shopper with
    // a duplicate entry they cannot tell apart.
    const existing = await tx.paymentMethod.findFirst({
      where: { stripePaymentMethodId: stripeMethodId, profileId: req.user.id },
    });

    const row = existing
      ? await tx.paymentMethod.update({
          where: { id: existing.id },
          data: { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year },
        })
      : await tx.paymentMethod.create({
          data: {
            profileId: req.user.id,
            stripePaymentMethodId: stripeMethodId,
            brand: card.brand,
            last4: card.last4,
            expMonth: card.exp_month,
            expYear: card.exp_year,
            isDefault: isFirst,
          },
        });

    return row;
  });

  // After the transaction, not inside it. A Stripe round trip inside prisma.$transaction holds
  // a database transaction open for the length of a network call to a third party, and a slow
  // Stripe response here would show up as lock contention on this shopper's own rows.
  if (isFirst) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: stripeMethodId },
    });
  }

  ok(res, toResponse(saved), "Card saved");
});

/** PATCH /account/payment-methods/:id/default */
paymentMethodsRouter.patch("/:id/default", async (req, res) => {
  const method = await requireOwnedMethod(req.params.id, req.user.id);
  if (method.isDefault) return ok(res, toResponse(method));

  const profile = await prisma.profile.findUnique({ where: { id: req.user.id } });
  if (!profile?.stripeCustomerId) throw new AppError("No Stripe customer for this account", 400);

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.updateMany({
      where: { profileId: req.user.id, isDefault: true },
      data: { isDefault: false },
    });
    await tx.paymentMethod.update({ where: { id: method.id }, data: { isDefault: true } });
  });

  // Stripe's own default is what an off-session charge actually reads, so both sides are moved.
  await stripeClient().customers.update(profile.stripeCustomerId, {
    invoice_settings: { default_payment_method: method.stripePaymentMethodId },
  });

  ok(res, toResponse({ ...method, isDefault: true }), "Default card updated");
});

/** DELETE /account/payment-methods/:id */
paymentMethodsRouter.delete("/:id", async (req, res) => {
  const method = await requireOwnedMethod(req.params.id, req.user.id);
  const profile = await prisma.profile.findUnique({ where: { id: req.user.id } });

  // The row goes first. A Stripe failure here must not leave a card listed that the shopper
  // has just been told is removed; an orphan over on Stripe's side is harmless, whereas a row
  // that outlives its deletion is a card the UI still offers to charge.
  await prisma.paymentMethod.delete({ where: { id: method.id } });

  if (profile?.stripeCustomerId) {
    await detachQuietly(method.stripePaymentMethodId);
  }

  if (method.isDefault) {
    const replacement = await prisma.paymentMethod.findFirst({
      where: { profileId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    if (replacement && profile?.stripeCustomerId) {
      await prisma.paymentMethod.update({
        where: { id: replacement.id },
        data: { isDefault: true },
      });
      await stripeClient().customers.update(profile.stripeCustomerId, {
        invoice_settings: { default_payment_method: replacement.stripePaymentMethodId },
      });
    }
  }

  ok(res, {}, "Card removed");
});

/**
 * Detaching is best-effort by design.
 *
 * Stripe rejects detaching a method that is still attached to an open invoice or in use as the
 * customer's default, and the shopper should not be shown an error for a card that has already
 * been removed from their book. Reported, not swallowed, so an operator can see a real failure.
 */
async function detachQuietly(stripePaymentMethodId: string): Promise<void> {
  try {
    await stripeClient().paymentMethods.detach(stripePaymentMethodId);
  } catch (err) {
    console.error(`Failed to detach Stripe payment method ${stripePaymentMethodId}:`, err);
  }
}

export default paymentMethodsRouter;
