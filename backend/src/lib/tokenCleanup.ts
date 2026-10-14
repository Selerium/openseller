import { prisma } from "./prismaClient.ts";

/**
 * Cleanup expired and revoked refresh tokens
 * - Remove tokens revoked more than 7 days ago
 * - Remove tokens expired more than 30 days ago
 * - Remove old tokens (created more than 90 days ago, even if not expired/revoked)
 */
export async function cleanupRefreshTokens() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Delete revoked tokens older than 7 days
  const deletedRevoked = await prisma.refreshTokens.deleteMany({
    where: {
      revokedAt: { not: null, lt: sevenDaysAgo },
    },
  });

  // Delete expired tokens older than 30 days
  const deletedExpired = await prisma.refreshTokens.deleteMany({
    where: {
      revokedAt: null,
      expiresAt: { lt: thirtyDaysAgo },
    },
  });

  // Delete very old tokens (created > 90 days ago) regardless of status
  const deletedOld = await prisma.refreshTokens.deleteMany({
    where: {
      createdAt: { lt: ninetyDaysAgo },
    },
  });

  return {
    revoked: deletedRevoked.count,
    expired: deletedExpired.count,
    old: deletedOld.count,
    total: deletedRevoked.count + deletedExpired.count + deletedOld.count,
  };
}

/**
 * Cleanup unverified user accounts older than 24 hours.
 *
 * `emailChangedAt: null` is load-bearing, and it is there because of a bug this function caused.
 *
 * The original predicate was `emailVerified: false AND createdAt < 24h AND token != null`, read as
 * "an account nobody finished signing up for". Once email changes set emailVerified back to false
 * -- correctly, that is the whole reverification flow -- that same predicate also matched a user
 * who registered, verified, and then changed their address within a day of registering. The sweep
 * would delete them: orders, reviews, addresses and saved cards, since those hang off Profile.
 *
 * createdAt cannot express the difference, because it answers "how old is the account" when the
 * question is "how long has this address been unproven". Those diverge as soon as an established
 * account changes address: a three-year-old account changing its email is an hour past
 * unverified, but three years past the sweep's threshold.
 *
 * A null emailChangedAt means the address has never been changed, so it is still the one the user
 * signed up with, so they never received mail proving they own it -- which is exactly the
 * abandoned signup. Note this cannot exempt an account that changed address *without* verifying:
 * email changes require a session, and sessions require verification, so the column being set
 * already implies the address was once proven.
 */
export async function cleanupUnverifiedUsers() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const deleted = await prisma.user.deleteMany({
    where: {
      emailVerified: false,
      createdAt: { lt: oneDayAgo },
      emailVerificationToken: { not: null },
      emailChangedAt: null,
    },
  });

  return { count: deleted.count };
}
