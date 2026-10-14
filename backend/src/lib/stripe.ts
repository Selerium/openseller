import Stripe from "stripe";
import AppError from "./appError.ts";
import { config } from "./config.ts";

/**
 * Lazily constructed Stripe client.
 *
 * Lazily because the constructor throws on an empty key, and this module is imported by code
 * that runs on every request (the storefront hits /products before anyone reaches checkout).
 * Requiring a key at import time would take the whole API down for a missing payment
 * credential, when the correct behaviour is that browsing keeps working and only checkout
 * refuses.
 *
 * Only the secret key is used. Checkout is a redirect to Stripe-hosted Checkout, so the
 * browser never needs a publishable key and no Stripe.js is loaded.
 */
let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(config.stripeSecretKey);
}

export function stripeClient(): Stripe {
  if (!config.stripeSecretKey) {
    throw new AppError(
      "Payments are not configured on this server (STRIPE_SECRET_KEY is unset)",
      503,
    );
  }
  client ??= new Stripe(config.stripeSecretKey);
  return client;
}

/**
 * Verify and decode a webhook payload.
 *
 * Takes the raw bytes, never the parsed body: signature verification is computed over the exact
 * bytes Stripe signed, and re-serialising a parsed object is not guaranteed to reproduce them.
 * Any mismatch throws, and Stripe's errors deliberately say nothing about which part failed.
 */
export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string | undefined,
): Stripe.Event {
  if (!config.stripeWebhookSecret) {
    throw new AppError(
      "Webhook signature verification is not configured (STRIPE_WEBHOOK_SECRET is unset)",
      503,
    );
  }
  if (!signature) {
    throw new AppError("Missing stripe-signature header", 400);
  }

  // Stripe types this as non-null, but it can be absent at runtime when the header is missing,
  // which is exactly the case handled above.
  return stripeClient().webhooks.constructEvent(
    rawBody,
    signature,
    config.stripeWebhookSecret,
  );
}