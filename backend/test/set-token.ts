/**
 * Overwrites a user's email verification token, for suites that need to drive the token paths
 * without an inbox.
 *
 * Run inside the backend container, like sweep.ts and make-account.ts: `make test-set-token`.
 *
 * Why a script and not an endpoint: every route that mints a token mails it, and a suite that
 * needs to prove what happens to an *expired* token cannot wait 24 hours or read a mailbox. This
 * reaches past the transport and writes the row directly, which is the same reason
 * make-account.ts sets emailVerified by hand.
 *
 *   node test/set-token.ts <email> --expire   write an already-expired token
 *   node test/set-token.ts <email>            write a fresh, valid one
 *
 * Prints { token, email } as JSON. The plaintext exists only here and in the caller's memory; the
 * row holds its SHA-256, which is the whole reason verification stores a digest.
 *
 * `mode=none` clears the token instead, which is how a suite reproduces a link that was already
 * used -- the row a second visit to /verify-email finds nothing for.
 */
import crypto from "crypto";
import { prisma } from "../src/lib/prismaClient.ts";

const [emailArg, ...flags] = process.argv.slice(2);
const mode = flags.find((f) => f.startsWith("--"))?.slice(2) || "valid";

if (!emailArg) {
  console.error(
    "usage: node test/set-token.ts <email> [--valid|--expire|--none]",
  );
  process.exit(1);
}

if (!["valid", "expire", "none"].includes(mode)) {
  console.error(`unknown mode "${mode}"; want valid, expire or none`);
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();

const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

if (!user) {
  console.error(`no user with email ${email}`);
  process.exit(1);
}

if (mode === "none") {
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificationToken: null, emailVerificationTokenExpiresAt: null },
  });
  console.log(JSON.stringify({ email, token: null }));
  await prisma.$disconnect();
  process.exit(0);
}

const token = crypto.randomBytes(32).toString("hex");
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

// An expired token is written as genuinely past-due rather than as a negative TTL, so the row is
// indistinguishable from one that aged out on its own. A suite asserting on the 410 path should
// not be able to tell which produced it.
const expiresAt =
  mode === "expire"
    ? new Date(Date.now() - 60 * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

await prisma.user.update({
  where: { id: user.id },
  data: {
    emailVerificationToken: tokenHash,
    emailVerificationTokenExpiresAt: expiresAt,
  },
});

console.log(JSON.stringify({ email, token, expiresAt: expiresAt.toISOString() }));
await prisma.$disconnect();
