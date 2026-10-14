import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const B = "http://localhost";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${e}`)); };
const j = async (p, o = {}) => {
  const r = await fetch(B + p, { ...o, headers: { "Content-Type": "application/json", ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// Suite runs from the repo root (like every other suite in test/), and the container paths below
// are relative to that.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Runs a script inside the backend container and parses its JSON.
 *
 * Needed because the token paths cannot be driven over HTTP: every route that mints a token
 * mails it, and there is no inbox here to read it out of. Same reason make-account.ts exists.
 * The account under test is the seeded sarah@, not a throwaway, because the email-change half of
 * this suite needs a real account it can rename.
 */
function inContainer(script, ...args) {
  const proc = spawnSync(
    "docker",
    ["compose", "exec", "-T", "backend", "node", `/app/test/${script}`, ...args],
    { cwd: ROOT, encoding: "utf8" },
  );
  const out = (proc.stdout || "").trim();
  if (proc.status !== 0) {
    throw new Error(`${script} failed: ${(proc.stderr || out).trim()}`);
  }
  return JSON.parse(out.split("\n").pop());
}

const setToken = (email, mode) => inContainer("set-token.ts", email, `--${mode}`);

// This suite renames a real account, because that is the only way to exercise the email-change
// flow end to end. It therefore needs a target address that cannot already be taken, and it
// leaves the shopper renamed — `make test` re-seeds sarah@openseller.test and sweeps the
// `changed.test` accounts afterwards, so the suite is repeatable. Without that, the second run
// fails on "Email is already in use" against its own residue.
//
// It also verifies the account at the end (so the sweep and the re-seed both see a sane state)
// and leaves one throwaway @changed.test registration behind from the normalization checks,
// which the sweep's `@changed\.test$` pattern covers.
const target = `sarah.changed.${Date.now()}@changed.test`;

const l1 = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "sarah@openseller.test", password: "password123" }) });
const jar = l1.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
ok("seeded shopper logs in", l1.status === 200, `got ${l1.status}`);

const before = await j("/api/me", { headers: { cookie: jar } });
ok("/me email before", before.body.data.email === "sarah@openseller.test", before.body.data.email);
ok("/me verified before", before.body.data.emailVerified === true);

const changed = await j("/api/profile/email", { method: "PUT", headers: { cookie: jar },
  body: JSON.stringify({ currentPassword: "password123", newEmail: target }) });
ok("email change accepted", changed.status === 200, `got ${changed.status} ${JSON.stringify(changed.body)}`);
ok("response reports unverified", changed.body.data?.emailVerified === false);

// the new address must be enforced
const after = await j("/api/me", { headers: { cookie: jar } });
ok("/me shows new email", after.body.data.email === target, after.body.data.email);
ok("/me shows unverified", after.body.data.emailVerified === false);

// logging in under the new address is now refused until verified
const l2 = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: target, password: "password123" }) });
ok("unverified new email cannot log in", l2.status === 403, `got ${l2.status}`);

// a duplicate address is still refused
const l3 = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "priya@openseller.test", password: "password123" }) });
const jar3 = l3.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const dupe = await j("/api/profile/email", { method: "PUT", headers: { cookie: jar3 },
  body: JSON.stringify({ currentPassword: "password123", newEmail: target }) });
ok("duplicate email refused 409", dupe.status === 409, `got ${dupe.status}`);

// wrong password refused
const bad = await j("/api/profile/email", { method: "PUT", headers: { cookie: jar3 },
  body: JSON.stringify({ currentPassword: "wrong", newEmail: "x@openseller.test" }) });
ok("wrong password refused 401", bad.status === 401, `got ${bad.status}`);

// ---------------------------------------------------------------------------
// Expired token. This is the case the flow used to get wrong: a real but expired link and a
// mangled one both answered 400 "please register again", which after an email change is advice
// that cannot be followed -- the account exists under the new address, so registering collides
// with itself and the user is stuck with no way back in.
// ---------------------------------------------------------------------------

const { token: expiredToken } = setToken(target, "expire");

const expired = await j("/api/verify-email", {
  method: "POST",
  body: JSON.stringify({ token: expiredToken }),
});
ok("expired token 410 not 400", expired.status === 410, `got ${expired.status}`);
ok("expired token offers resend", expired.body?.data?.canResend === true, JSON.stringify(expired.body));
ok("expired token returns address to prefill", expired.body?.data?.email === target, JSON.stringify(expired.body));
ok(
  "expired message no longer says register again",
  !/register again/i.test(expired.body?.message || ""),
  expired.body?.message,
);
ok("expired token does not verify", (await j("/api/me", { headers: { cookie: jar } })).body.data.emailVerified === false);

// a token that was never issued gets 400 and, unlike the expired case, no address back
const bogus = await j("/api/verify-email", {
  method: "POST",
  body: JSON.stringify({ token: "f".repeat(64) }),
});
ok("unknown token 400", bogus.status === 400, `got ${bogus.status}`);
ok("unknown token leaks no address", !bogus.body?.data?.email, JSON.stringify(bogus.body));

// ---------------------------------------------------------------------------
// Recovery: resend, then verify with the new link.
// ---------------------------------------------------------------------------

const resend = await j("/api/resend-verification", {
  method: "POST",
  body: JSON.stringify({ email: target }),
});
ok("resend 200", resend.status === 200, `got ${resend.status}`);

const { token: liveToken } = setToken(target, "valid");

const verified = await j("/api/verify-email", {
  method: "POST",
  body: JSON.stringify({ token: liveToken }),
});
ok("resent token verifies", verified.status === 200, `got ${verified.status} ${JSON.stringify(verified.body)}`);

const nowVerified = await j("/api/me", { headers: { cookie: jar } });
ok("/me shows verified", nowVerified.body.data.emailVerified === true);

// single use: the same link again must not succeed
const replay = await j("/api/verify-email", {
  method: "POST",
  body: JSON.stringify({ token: liveToken }),
});
ok("token is single-use", replay.status === 400, `got ${replay.status}`);

// and the account is usable again
const l4 = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: target, password: "password123" }) });
ok("verified new address logs in", l4.status === 200, `got ${l4.status}`);

// ---------------------------------------------------------------------------
// Normalization. Register stored the address as typed while login matched it exactly and
// resend-verification lowercased it, so a mixed-case signup was unreachable from both of the
// other two paths. All four now agree on trim + lowercase.
// ---------------------------------------------------------------------------

const mixedCase = `Mixed.Case.${Date.now()}@changed.test`;
const reg = await j("/api/register", {
  method: "POST",
  body: JSON.stringify({
    fullName: "Mixed Case",
    email: `  ${mixedCase.toUpperCase()}  `,
    password: "password123",
    confirmPassword: "password123",
  }),
});
ok("register accepts padded uppercase", reg.status === 200, `got ${reg.status} ${JSON.stringify(reg.body)}`);

const mixedLogin = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: mixedCase, password: "password123" }) });
// 403 rather than 200/404: unverified, so the address was found -- which is the point being asserted
ok("mixed-case address is found at login", mixedLogin.status === 403, `got ${mixedLogin.status}`);

const paddedChange = await j("/api/profile/email", { method: "PUT", headers: { cookie: jar3 },
  body: JSON.stringify({ currentPassword: "password123", newEmail: `  ${mixedCase}  ` }) });
// the 409 is proof the padded input normalized onto the row register created
ok("padded change-email normalizes to same row", paddedChange.status === 409, `got ${paddedChange.status}`);

// invalid address refused outright, rather than stored and discovered at the login prompt
const invalid = await j("/api/profile/email", { method: "PUT", headers: { cookie: jar3 },
  body: JSON.stringify({ currentPassword: "password123", newEmail: "not-an-email" }) });
ok("invalid address refused 400", invalid.status === 400, `got ${invalid.status}`);

// ---------------------------------------------------------------------------
// Put sarah back, so the suite is repeatable without a re-seed.
//
// Everything above leaves the seeded shopper renamed and verified under a @changed.test address.
// Without this the *next* run cannot log in as sarah@openseller.test at all, so the failure shows
// up as an unrelated-looking 404 on the suite's first check. The address is verified by the run
// itself (the resend-then-verify block), which is the state the seed expects.
//
// jar, sarah's own session, and NOT jar3. This used jar3 on the theory that jar's refresh token
// had been rotated by the /me calls above. That was wrong twice over: jar3 is *priya's* cookie,
// so the call renamed a completely different shopper to sarah@openseller.test and left sarah
// stranded under @changed.test -- and on the following run priya's login failed, so jar3 came
// back empty, the restore answered 401, and the suite left both accounts missing. The credential
// matters only in that it has to be the account that owns `target`, which is sarah.
//
// The access token in jar is enough for the full suite: it is a 15-minute token and this runs in
// seconds, and checkTokens accepts it on the fast path without touching refresh rotation.
// ---------------------------------------------------------------------------
const restored = await j("/api/profile/email", { method: "PUT", headers: { cookie: jar },
  body: JSON.stringify({ currentPassword: "password123", newEmail: "sarah@openseller.test" }) });
ok("seeded address restored", restored.status === 200, `got ${restored.status} ${JSON.stringify(restored.body)}`);

const { token: restoreToken } = setToken("sarah@openseller.test", "valid");
const restoreVerify = await j("/api/verify-email", {
  method: "POST",
  body: JSON.stringify({ token: restoreToken }),
});
ok("seeded address re-verified", restoreVerify.status === 200, `got ${restoreVerify.status}`);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
