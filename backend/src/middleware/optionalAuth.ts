import jwt from "jsonwebtoken";

/**
 * Populate `req.user` when a valid access token is presented, and leave it alone when not.
 *
 * The checkout router needs this because it answers guests as well as shoppers. It sits above
 * the protected mount in app.ts, so `checkTokens` never runs there — which is why
 * `req.user?.id` in POST /checkout/session has always been undefined and every order,
 * including one placed by a signed-in shopper, is written as a guest order.
 *
 * Deliberately not `checkTokens` with the throwing behaviour removed:
 *
 *   - it must never 401, or a guest could not check out;
 *   - it must not rotate tokens. Rotation replaces the cookies on a response, and a checkout
 *     response that quietly reissued auth cookies would be one more thing to reason about on a
 *     route whose whole job is to hand back a redirect. A stale access token simply means the
 *     caller falls back to the guest-token proof (see callerOwnsOrder in lib/orders.ts).
 */
const optionalAuth = (req, _res, next) => {
  const token = req.cookies?.access_token;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || "");
    } catch {
      // Expired or forged: treat the request as the guest it may well be.
    }
  }
  next();
};

export default optionalAuth;
