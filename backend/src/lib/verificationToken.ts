import crypto from "crypto";

/**
 * Minting, hashing and expiring email verification tokens.
 *
 * Four call sites used to inline this: register, email change, resend-verification, and the
 * verify endpoint that reads the expiry back. They each carried their own copy of the TTL
 * arithmetic, so the window a link actually lives for was defined in four places and changing it
 * meant finding all four. They are one concept, so they live here.
 *
 * The token is a 256-bit random string; only its SHA-256 is stored. That is enough entropy that a
 * digest is the right tool -- the reasoning behind not using bcrypt for the *refresh* token is
 * written up in lib/tokens.ts and does not apply here, because a verification token is compared
 * by indexed equality rather than by scanning candidates, and is worthless the moment it is used.
 */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface IssuedVerificationToken {
  /** The plaintext token. Only ever returned to the mail transport, never persisted. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Issues a token and the values to persist for it. */
export function issueVerificationToken(): IssuedVerificationToken {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashVerificationToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  };
}

export function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
