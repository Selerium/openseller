/**
 * Removes accounts the test suites create, so repeated runs don't collide with their own
 * residue.
 *
 * Profile -> User is RESTRICT, so a User cannot be deleted while its Profile exists. That
 * restriction is deliberate (see the "User / Profile split" decision: deleting credentials must
 * not cascade into order history), which means cleanup has to go Profile first. Only safe
 * because the matched accounts are test throwaways that own no orders, addresses or reviews —
 * the deletes below cascade, and there is nothing to lose.
 *
 * Run inside the backend container: `make test-sweep`.
 */
import { prisma } from "../src/lib/prismaClient.ts";

// `acct.` is the account suite's prefix: it needs a throwaway it can actually delete, and the
// accounts it does not delete have to go here or every run leaks one. `orders.` is the orders
// suite's verified throwaway (used to prove email ownership of a guest order).
const TEST_EMAIL = /(@changed\.test$|^sarah\.new@openseller\.test$|^(verify|flow|final|revoke|acct|orders)\..*@openseller\.test$)/;

// Test guest orders have no User row, so the user sweep cannot reach them. The orders suite
// creates them with `orders.*@openseller.test` addresses (both DB-written rows from
// make-order.ts and real checkouts), so they are swept by address.
const staleOrders = await prisma.order.deleteMany({
  where: {
    guestEmail: { startsWith: "orders.", endsWith: "@openseller.test" },
  },
});

// Query broadly and filter in JS. The addresses do not share a domain — the email suite writes
// to @changed.test while the ad-hoc checks wrote to @openseller.test — so a single
// `contains` filter silently misses whichever set you did not think about, and the sweep then
// reports "nothing to clean" while the residue is still there.
const victims = await prisma.user.findMany({ select: { id: true, email: true } });
const stale = victims.filter((u) => TEST_EMAIL.test(u.email));

if (!stale.length && staleOrders.count === 0) {
  console.log("test sweep: nothing to clean");
} else {
  const ids = stale.map((u) => u.id);
  const profiles = await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  const users = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(
    `test sweep: removed ${staleOrders.count} test order(s), ${users.count} test account(s)`,
  );
  if (profiles.count !== users.count) {
    console.warn(`test sweep: WARNING ${profiles.count} profiles vs ${users.count} users`);
  }
}

await prisma.$disconnect();