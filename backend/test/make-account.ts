/**
 * Creates one verified throwaway shopper, for suites that need an account they can destroy.
 *
 * Run inside the backend container, like sweep.ts: `make test-account email=...`.
 *
 * Why not POST /register: registration deliberately leaves emailVerified false and mails a
 * token, so a self-registered account cannot log in and every authenticated check against it
 * would fail on a 403 that has nothing to do with what is being tested. Verification here is
 * set directly because there is no inbox to read.
 *
 * The password is printed so the caller can log in over HTTP, and the address is echoed so the
 * caller knows what it asked for. Both are throwaway credentials for a throwaway account; the
 * seed password is the same, which is what every other suite already uses.
 *
 * Cleanup is test/sweep.ts's job — it matches on the @openseller.test domain this writes to.
 */
import bcrypt from "bcryptjs";
import { prisma, Role } from "../src/lib/prismaClient.ts";

const email = process.argv[2];
const password = process.argv[3] || "password123";

if (!email) {
  console.error("usage: node test/make-account.ts <email> [password]");
  process.exit(1);
}

const hashed = await bcrypt.hash(password, 10);

await prisma.user.deleteMany({ where: { email } }).catch(() => {});
const existing = await prisma.profile.findFirst({ where: { user: { email } } });
if (existing) await prisma.profile.delete({ where: { id: existing.id } });
await prisma.user.deleteMany({ where: { email } });

const user = await prisma.user.create({
  data: {
    email,
    password: hashed,
    emailVerified: true,
    profile: {
      create: { name: "Throwaway Shopper", role: Role.USER },
    },
  },
  select: { id: true },
});

console.log(JSON.stringify({ email, password, userId: user.id }));
