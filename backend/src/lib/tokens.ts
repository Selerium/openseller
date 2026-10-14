import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const secret = process.env.JWT_SECRET || "";

/**
 * JWT minting, in one place, because both token kinds have a subtlety that is easy to get
 * wrong independently at each call site.
 */

/**
 * Signs the access token. Subject is the Profile id, not the User id, so commerce code can
 * trust `req.user.id` without joining back to User.
 *
 * Access tokens are intentionally *not* nonce'd: they are short-lived and never persisted, so
 * a deterministic signature costs nothing and keeps the token stable within its 15 minutes.
 */
export function signAccessToken(profile: {
  id: string;
  name: string;
  role: string;
  firstTime: boolean;
}): string {
  return jwt.sign(
    { id: profile.id, name: profile.name, role: profile.role, firstTime: profile.firstTime },
    secret,
    { expiresIn: "15m", subject: profile.id },
  );
}

/**
 * Signs the refresh token.
 *
 * The `jti` is load-bearing, not decoration. A JWT is a pure function of (payload, secret),
 * and `iat` only has one-second resolution, so signing `{ id }` twice within the same second
 * produced a **byte-identical** token. That silently disabled rotation: checkTokens revoked the
 * presented token's row and then minted a replacement that was the same string, stored under a
 * new non-revoked row. A stolen refresh token therefore could be replayed forever — the one
 * threat rotation exists to contain — and the "old token is dead" property never held.
 *
 * A 128-bit random `jti` makes every issued token unique, so revocation is real.
 */
export function signRefreshToken(userId: string): string {
  return jwt.sign(
    { id: userId, jti: crypto.randomBytes(16).toString("hex") },
    secret,
    { expiresIn: "7d", subject: userId },
  );
}

/**
 * Digest for storing a refresh token.
 *
 * bcrypt is the wrong tool for this, and using it was a real authentication bypass.
 *
 * bcrypt silently ignores everything past the **first 72 bytes** of its input. A refresh JWT
 * for a given user is ~300 bytes, but its layout is fixed: the header is constant across every
 * token we mint, and the payload opens with `{"id":"<userId>","jti":...`. So byte 72 lands
 * inside the userId, and *every refresh token for the same user shares an identical 72-byte
 * prefix* — the `jti` and the signature both sit past the cutoff and were never hashed.
 *
 * The consequence: a freshly issued token matched the *previous* token's stored hash, so the
 * `bcrypt.compare` loop in checkTokens accepted a replayed token that had been revoked, and
 * rotation was inert.
 *
 * SHA-256 reads every byte, and the input already has ~256 bits of entropy from the signature
 * key plus the `jti`, so it needs no work factor. It is also indexable, which lets the lookup
 * become a single indexed query on the unique `tokenHash` column instead of a bcrypt
 * comparison against every live token for the user — that scan was O(n) per request and grew
 * without bound as sessions accumulated.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}