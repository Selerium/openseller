import { prisma } from "./prismaClient.ts";
import { stripeClient } from "./stripe.ts";
import AppError from "./appError.ts";

/**
 * The Stripe customer for a profile, created on first use.
 *
 * Shared by checkout and the saved-cards page because the two must agree on exactly one
 * customer per profile. If they each had their own copy of this logic, a shopper who checked
 * out before ever opening the payment-methods page would end up with two Stripe customers for
 * one email address, and the card saved against one would be invisible to charges raised
 * against the other.
 *
 * Idempotent by key rather than by check-then-write: two concurrent first-time calls would
 * otherwise each create a customer, orphaning whichever loses the race and leaving saved cards
 * attached to a customer this profile can no longer reach.
 *
 * Email comes from User, not Profile — the access token carries only the profile id.
 */
export async function ensureStripeCustomer(profileId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: { user: { select: { email: true } } },
  });
  if (!profile) throw new AppError("Profile not found", 404);
  if (profile.stripeCustomerId) return profile.stripeCustomerId;

  const customer = await stripeClient().customers.create(
    { email: profile.user.email },
    { idempotencyKey: `stripe-customer-${profileId}` },
  );

  await prisma.profile.update({
    where: { id: profileId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}
