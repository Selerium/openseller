function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Currency is stored as an ISO 4217 code and always rendered as letters, never a symbol.
 *
 * The storefront formats money as `${cents / 100} ${code}` rather than using Intl currency
 * symbols, on purpose: symbol output is locale-dependent and locale is a client concern, so
 * baking "US$" or "USD" into server-rendered HTML produces inconsistent output across
 * browsers and breaks copy-paste of a price. The code is unambiguous and self-describing.
 *
 * Minor units vary by currency (JPY has none, most have two, BHD/KWD have three), so the
 * divisor comes from the code rather than a hardcoded 100.
 */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
const THREE_DECIMAL = new Set(["bhd", "iqd", "jod", "kwd", "lyd", "omr", "tnd"]);

function normalizeCurrency(value: string): string {
  const code = value.trim().toLowerCase();
  // silently accepting "US Dollars" or "usd$" would make the storefront render nonsense,
  // so anything that is not a bare 3-letter code falls back to the default
  return /^[a-z]{3}$/.test(code) ? code : "usd";
}

export function minorUnitDivisor(currency: string): number {
  const code = normalizeCurrency(currency);
  if (ZERO_DECIMAL.has(code)) return 1;
  if (THREE_DECIMAL.has(code)) return 1000;
  return 100;
}

export const config = {
  prod: process.env.PROD === "true",

  // Store settings. A single currency is assumed throughout: every SUM of cents is
  // directly comparable. Multi-currency would require grouping by Order.currency.
  currency: normalizeCurrency(process.env.STORE_CURRENCY || "usd"),

  // divisor for converting integer minor units to a decimal amount. JPY has no minor unit,
  // so 10000 minor units is 10000 yen, not 100.
  currencyMinorUnitDivisor: minorUnitDivisor(process.env.STORE_CURRENCY || "usd"),

  // Auth cookie policy. See lib/cookies.ts for why this is not derived from PROD.
  // "lax" covers single-origin and same-registrable-domain deployments; "none" is required
  // when the API and the frontend sit on genuinely different domains.
  cookieSameSite: (
    process.env.COOKIE_SAME_SITE ||
    // a domain-scoped cookie is only useful alongside SameSite=none, since a cross-site
    // cookie without it is dropped by the browser anyway
    (process.env.COOKIE_DOMAIN ? "none" : "lax")
  ) as "lax" | "strict" | "none",
  // Public base URL of the *storefront* (the Next app), not the API.
  //
  // Both consumers are frontend routes, which is what makes this easy to get wrong: Stripe
  // redirects to /checkout/success, and verification / password-reset emails link to
  // /verify-email and /reset-password. None of those exist on the API, so pointing this at the
  // API origin yields links that 401 instead of failing loudly.
  //
  // Hence the mode-dependent dev default. Single-origin Docker mode has nginx serving both
  // from :80; the default split mode runs the frontend standalone on :3000 with the API on
  // :80. Defaulting to :80 unconditionally sent every verification link to the API.
  storeUrl: (
    process.env.STORE_URL ||
    (process.env.PROD === "true"
      ? "http://localhost"
      : process.env.DOCKER_MODE === "true"
        ? "http://localhost"
        : "http://localhost:3000")
  ).replace(/\/+$/, ""),

  // --- Stripe ---
  //
  // Checkout is a redirect to Stripe-hosted Checkout, so the secret key and the webhook signing
  // secret are all checkout itself needs. The publishable key is a third case: saving a card on
  // /profile/payment-methods mounts a Stripe Element in the page, and an Element cannot be
  // created without a publishable key. It is served to the browser from
  // GET /account/payment-methods/config rather than baked into the frontend at build time,
  // because it is a deploy-time secret in the usual setup — the same reason STRIPE_SECRET_KEY
  // is not NEXT_PUBLIC_*.
  //
  // All three absent is a supported state, not a crash. The storefront stays fully browsable and
  // the API answers normally; only POST /checkout/session and the payment-method endpoints
  // refuse, with a 503 that says which variable is missing. That matters for self-hosting, where
  // the first thing an operator does is boot the stack before signing up for anything.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",

  /**
   * Local-only stand-in for Stripe Checkout.
   *
   * Off unless ALLOW_MOCK_PAYMENTS=true is set explicitly. It exists so checkout, orders,
   * stock decrement and complaints can be exercised on a self-hosted box with no external
   * account at all, which is otherwise impossible for every dependency in the stack to be
   * local.
   *
   * It confirms payments without collecting any money, so it is refused outright when
   * PROD=true rather than merely defaulting off. A flag that only defaults to off is not a
   * sufficient guard for "this code path creates paid orders for free": an operator who
   * deploys without setting PROD would otherwise run a store where anyone can place a free
   * order. lib/index.ts also warns on every boot while it is on.
   */
  allowMockPayments: (() => {
    const requested = process.env.ALLOW_MOCK_PAYMENTS === "true";
    const prod = process.env.PROD === "true";
    if (requested && prod) {
      throw new Error(
        "ALLOW_MOCK_PAYMENTS=true is refused when PROD=true. It confirms orders without " +
          "charging anyone, so it must never be reachable in production.",
      );
    }
    return requested;
  })(),

  // admin "nearing out of stock" reporting
  lowStockThreshold: int(process.env.LOW_STOCK_THRESHOLD, 5),

  // product media. Relative paths resolve against the process cwd (/app in the container),
  // and the directory is bind mounted so uploads survive container rebuilds.
  uploadsDir: process.env.UPLOADS_DIR || "uploads",
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),

  // Raster only. SVG is deliberately excluded from user uploads because it is an
  // executable document format; serving it same-origin is how stored-XSS happens.
  uploadMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"] as const,

  // --- idempotency ---
  // See middleware/idempotency.ts for how these interact.
  //
  // The lease is deliberately much shorter than the record TTL. A reservation is written
  // before the handler runs and replaced by the response afterwards; if the process dies in
  // between, only the lease is left behind, and its expiry is what lets a retry through
  // instead of wedging the key until the long TTL expires.
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  idempotencyTtlSeconds: int(process.env.IDEMPOTENCY_TTL_SECONDS, 24 * 60 * 60),
  idempotencyLeaseSeconds: int(process.env.IDEMPOTENCY_LEASE_SECONDS, 60),
  // How long a duplicate waits for the original to finish before giving up with a 409.
  idempotencyWaitMs: int(process.env.IDEMPOTENCY_WAIT_MS, 3000),
  // Bounds a request when Redis accepts a connection but never answers.
  redisCommandTimeoutMs: int(process.env.REDIS_COMMAND_TIMEOUT_MS, 500),
};

export type Config = typeof config;
