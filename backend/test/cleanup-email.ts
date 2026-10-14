/**
 * Removes throwaway accounts by email prefix, for ad-hoc probing that made accounts outside the
 * test suites' own naming.
 *
 * Prefers an exact address; falls back to a prefix so a probe that created several accounts can
 * be cleaned in one call. Profile first, then User: the User -> Profile relation is RESTRICT, so
 * deleting the User while a Profile points at it is refused by Postgres. See sweep.ts.
 *
 * Run inside the backend container: `make test-clean-email prefix=acct.`
 */
import { prisma } from "../src/lib/prismaClient.ts";

const exact = process.argv[2];
const prefix = process.argv[3];

if (!exact && !prefix) {
  console.error("usage: node test/cleanup-email.ts <email> | <prefix...>");
  process.exit(1);
}

const victims = await prisma.user.findMany({ select: { id: true, email: true } });
const stale = victims.filter((u) =>
  exact ? u.email === exact : u.email.startsWith(prefix)
);

if (!stale.length) {
  console.log(`cleanup: nothing matching ${exact ?? prefix}`);
} else {
  const ids = stale.map((u) => u.id);
  const profiles = await prisma.profile.deleteMany({ where: { userId: { in: ids } } });
  const users = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`cleanup: removed ${users.count} account(s)`);
  console.log(stale.map((u) => `  ${u.email}`).join("\n"));
  if (profiles.count !== users.count) {
    console.warn(`cleanup: WARNING ${profiles.count} profiles vs ${users.count} users`);
  }
}

await prisma.$disconnect();
