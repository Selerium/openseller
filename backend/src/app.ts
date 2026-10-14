import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";

import registerHandler from "./controllers/register.ts";
import loginHandler from "./controllers/login.ts";
import checkEmailHandler from "./controllers/checkEmail.ts";
import emailVerificationHandler from "./controllers/emailVerification.ts";
import resendVerificationHandler from "./controllers/resendVerification.ts";
import forgotPasswordHandler from "./controllers/forgotPassword.ts";
import resetPasswordHandler from "./controllers/resetPassword.ts";
import errorHandler from "./middleware/errorHandler.ts";
import idempotency from "./middleware/idempotency.ts";
import protectedRouter from "./controllers/routeGuard.ts";
import catalogRouter from "./controllers/catalog/index.ts";
import checkoutRouter from "./controllers/checkout/index.ts";
import webhookHandler from "./controllers/checkout/webhook.ts";
import { prisma } from "./lib/prismaClient.ts";
import { config } from "./lib/config.ts";
import { ok } from "./lib/http.ts";
import { clearAuthCookies } from "./lib/cookies.ts";
import { hashRefreshToken } from "./lib/tokens.ts";

const app = express();

app.use(
  cors({
    // FRONTEND_URL is a comma separated list so a second origin (a Vercel preview, say) can
    // be added without a redeploy of this logic.
    //
    // This matters more than it looks: `credentials: "include"` means the browser enforces the
    // CORS allow-list on the auth cookie too, so an origin missing from here fails every
    // authenticated call rather than just the preflight.
    origin: (
      config.prod
        ? process.env.FRONTEND_URL
        : `${process.env.FRONTEND_URL || "http://localhost:3000"},http://localhost:80`
    )
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // Idempotency-Key is required here for the same reason: it is a non-safelisted request
    // header, so without it the preflight for every mutating call fails and no mutation
    // reaches the API at all in the split-origin dev setup.
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  }),
);

// Stripe webhook. Mounted before express.json(), and with its own raw parser, because the
// signature is computed over the exact bytes Stripe signed: re-serialising a parsed body is not
// guaranteed to reproduce them, and a signature check against reconstructed JSON fails at random.
//
// Also before the idempotency middleware, which is correct in both directions. A webhook is not
// a client request and carries no Idempotency-Key, so fingerprinting it would be meaningless;
// and it is already idempotent by design (markOrderPaid is a no-op on an order that is already
// paid), which is what Stripe's retries need.
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhookHandler,
);

// `verify` stashes the untouched body, kept because a second consumer may need the raw bytes.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(cookieParser());

app.get("/health", (_req, res) => {
  ok(res, {}, "Backend connection works");
});
// legacy alias
app.get("/test", (_req, res) => {
  ok(res, {}, "Backend connection works");
});

// Product media. Public and read-only. The CSP + nosniff headers neutralise any active content
// in an uploaded file if it is ever opened directly rather than rendered in an <img>.
app.use(
  "/uploads",
  express.static(path.resolve(config.uploadsDir), {
    index: false,
    dotfiles: "deny",
    maxAge: config.prod ? "7d" : 0,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    },
  }),
);

// Idempotency for mutating requests, keyed by the client's `Idempotency-Key` header.
//
// Position matters twice over. It must sit *after* express.json() so the fingerprint is
// computed from a parsed body rather than an opaque byte count, and *before* every router so
// a replayed key short-circuits ahead of the handler instead of running it and then trying to
// undo the damage. Reads pass straight through.
app.use(idempotency);

app.use("/register", registerHandler);
app.use("/login", loginHandler);
app.use("/check-email", checkEmailHandler);
app.use("/verify-email", emailVerificationHandler);
app.use("/resend-verification", resendVerificationHandler);
app.use("/forgot-password", forgotPasswordHandler);
app.use("/reset-password", resetPasswordHandler);
app.post("/logout", async (req, res) => {
  clearAuthCookies(res);

  // Revoke before responding. The previous version responded first and then did this work
  // unawaited, so a failure here became an unhandled rejection *after* the client was already
  // told logout succeeded, leaving the refresh token live with nobody left to clean it up.
  //
  // One indexed lookup, not a scan over every live token in the system: the old loop matched
  // on a 72-byte bcrypt prefix, which is shared by all of a given user's tokens, so it could
  // revoke a *different* session of the same user and leave the presented one alive.
  const refreshToken = req.cookies.refresh_token;
  if (refreshToken) {
    const digest = hashRefreshToken(refreshToken);
    await prisma.refreshTokens.updateMany({
      where: { tokenHash: digest, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  res.json({ data: {}, message: "Logged out", error: false });
});

// Public catalog. Must stay above the protected mount below, which guards everything after it.
app.use("", catalogRouter);
// Checkout is mounted above the protected router on purpose: guests are the main audience for a
// storefront, so POST /checkout/session has to work with no session at all. It reads req.user
// only opportunistically.
app.use("/checkout", checkoutRouter);
app.use("", protectedRouter);
app.use(errorHandler);

export default app;


import reviewsRouter from "./controllers/reviews/index.ts";
app.use("/reviews", reviewsRouter);
