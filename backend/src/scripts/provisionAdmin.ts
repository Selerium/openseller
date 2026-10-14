/**
 * Provisions the first admin account on a fresh deploy.
 *
 * Run inside the backend container AFTER `prisma migrate deploy` (and optionally after
 * `make seed`):
 *
 *   docker compose exec backend node src/scripts/provisionAdmin.ts "boss@example.com" "correct horse battery staple"
 *
 * Why a script and not POST /register: registration leaves emailVerified false and mails
 * a token, so a self-registered account cannot log in until mail works — and nothing may
 * promote it to ADMIN without an existing admin. This sets verified + ADMIN directly,
 * which is safe here because whoever can exec into the container already owns the box.
 *
 * Idempotent by email: re-running with the same address resets that account's password
 * and ensures the ADMIN role instead of creating a duplicate. Refuses to run when the
 * address belongs to the demo seed, so a deploy script cannot accidentally lock the
 * throwaway accounts into admin — delete those first if this is a real store.
 */
import bcrypt from "bcryptjs";
import { prisma, Role } from "../lib/prismaClient.ts";
import { normalizeEmail } from "../lib/emailAddress.ts";

const rawEmail = process.argv[2] || process.env.PROVISION_ADMIN_EMAIL;
// Password via env keeps it out of `ps` output; argv stays for one-off manual runs.
const password = process.argv[3] || process.env.PROVISION_ADMIN_PASSWORD;

if (!rawEmail || !password) {
  console.error("usage: node src/scripts/provisionAdmin.ts <email> <password>");
  console.error("   or: PROVISION_ADMIN_EMAIL=.. PROVISION_ADMIN_PASSWORD=.. node src/scripts/provisionAdmin.ts");
  process.exit(1);
}

if (password.length < 12) {
  console.error("password must be at least 12 characters");
  process.exit(1);
}

const email = normalizeEmail(rawEmail);

if (email.endsWith("@openseller.test")) {
  console.error("refusing demo-seed address: use a real email for the store owner");
  process.exit(1);
}

// Wiping and recreating (like test/make-account.ts) would orphan that profile's orders,
// reviews and address book rows onto nothing — an owner's history must survive a password
// reset. So an existing account is updated in place instead.
const hashed = await bcrypt.hash(password, 10);

const existing = await prisma.user.findUnique({
  where: { email },
  select: { id: true, profile: { select: { id: true } } },
});

if (!existing) {
  await prisma.user.create({
    data: {
      email,
      password: hashed,
      emailVerified: true,
      profile: {
        create: { name: email.split("@")[0] || "Store owner", role: Role.ADMIN },
      },
    },
  });
  console.log(JSON.stringify({ email, created: true }));
} else {
  await prisma.user.update({
    where: { id: existing.id },
    data: { password: hashed, emailVerified: true },
  });
  if (existing.profile) {
    await prisma.profile.update({
      where: { id: existing.profile.id },
      data: { role: Role.ADMIN },
    });
  } else {
    await prisma.profile.create({
      data: { userId: existing.id, name: email.split("@")[0] || "Store owner", role: Role.ADMIN },
    });
  }
  console.log(JSON.stringify({ email, created: false, promoted: true }));
}

await prisma.$disconnect();
