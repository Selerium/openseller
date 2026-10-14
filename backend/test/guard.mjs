// Verifies the routeGuard restructure: per-path checkTokens mounting, the refresh-token
// path, the admin role guard, and 404 vs 401 separation.
const BASE = "http://localhost/api";

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function call(path, { method = "GET", cookie, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, body: parse(await res.text()), setCookie };
}

function jar(setCookie) {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

function pick(setCookie, name) {
  for (const c of setCookie) {
    const [pair] = c.split(";");
    const [k, ...v] = pair.split("=");
    if (k === name) return pair;
  }
  return null;
}

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

console.log("\n=== unauthenticated ===");
for (const path of ["/me", "/profile", "/profiles", "/admin/uploads"]) {
  const r = await call(path);
  check(`${path} 401 without a session`, r.status === 401, `got ${r.status}`);
}

console.log("\n=== unmatched paths are 404, not 401 ===");
for (const path of ["/verify-email", "/reset-password", "/nope", "/adminish"]) {
  const r = await call(path);
  check(`${path} 404`, r.status === 404, `got ${r.status}: ${r.body.message}`);
}

console.log("\n=== login as admin, then the admin-only surface ===");
const adminLogin = await call("/login", {
  method: "POST",
  body: { email: "admin@openseller.test", password: "password123" },
});
check("admin login", adminLogin.status === 200, `got ${adminLogin.status}: ${adminLogin.body.message}`);
const adminJar = jar(adminLogin.setCookie);
check("login set access cookie", adminJar.includes("access_token"));
check("login set refresh cookie", adminJar.includes("refresh_token"));

const meAdmin = await call("/me", { cookie: adminJar });
check("/me as admin", meAdmin.status === 200, `got ${meAdmin.status}`);
check("/me reports the role", meAdmin.body.data?.role === "ADMIN", JSON.stringify(meAdmin.body.data));

// requireAdmin reads req.user, which only exists because checkTokens ran on this path.
// The only admin route that exists so far is the upload mount; the product CRUD is Phase 5.
const adminUploads = await call("/admin/uploads", { cookie: adminJar, method: "POST", body: {} });
check(
  "admin passes the role guard on /admin/uploads",
  adminUploads.status !== 401 && adminUploads.status !== 403,
  `got ${adminUploads.status}: ${adminUploads.body.message}`,
);

console.log("\n=== refresh token still refreshes (checkTokens refresh path) ===");
// drop the access cookie, keep only the refresh cookie -> must re-issue both
const refreshOnly = pick(adminLogin.setCookie, "refresh_token");
const refreshed = await call("/me", { cookie: refreshOnly });
check("/me with only a refresh cookie", refreshed.status === 200, `got ${refreshed.status}: ${refreshed.body.message}`);
const newAccess = pick(refreshed.setCookie, "access_token");
const newRefresh = pick(refreshed.setCookie, "refresh_token");
check("refresh re-issued an access cookie", !!newAccess);
check("refresh re-issued a refresh cookie", !!newRefresh);
check(
  "refresh cookie actually rotated",
  newRefresh !== pick(adminLogin.setCookie, "refresh_token"),
  "reissuing the same refresh token would make rotation a no-op",
);
// the access token is deliberately NOT nonce'd, so re-minting it inside the same second
// yields an identical string; that is expected and harmless. See lib/tokens.ts.

// the rotated-away refresh token must be rejected
const staleRefresh = await call("/me", { cookie: pick(adminLogin.setCookie, "refresh_token") });
check("old refresh token rejected", staleRefresh.status === 401, `got ${staleRefresh.status}`);

console.log("\n=== a revoked/garbage token is 401, not 404 ===");
const garbage = await call("/me", { cookie: "access_token=not-a-jwt; refresh_token=not-a-jwt" });
check("garbage tokens 401", garbage.status === 401, `got ${garbage.status}`);

console.log("\n=== a token is bound to the session that issued it ===");
async function refreshOf(email) {
  const r = await call("/login", { method: "POST", body: { email, password: "password123" } });
  // pick() returns the full "name=value" pair; callers below prepend the name themselves
  return pick(r.setCookie, "refresh_token").split("=").slice(1).join("=");
}
const t1 = await refreshOf("admin@openseller.test");
const t2 = await refreshOf("admin@openseller.test");
check("two logins yield distinct refresh tokens", t1 !== t2);

// logging out of session A must not kill session B
const logoutA = await call("/logout", { method: "POST", cookie: `refresh_token=${t1}` });
check("logout A succeeds", logoutA.status === 200, `got ${logoutA.status}`);
const bStillWorks = await call("/me", { cookie: `refresh_token=${t2}` });
check("session B survives logout of A", bStillWorks.status === 200, `got ${bStillWorks.status}`);
const aIsDead = await call("/me", { cookie: `refresh_token=${t1}` });
check("session A is dead after its own logout", aIsDead.status === 401, `got ${aIsDead.status}`);

// a customer's token must not authenticate as the admin
const cust = await call("/login", { method: "POST", body: { email: "mike@openseller.test", password: "password123" } });
const ct = cust.status === 200 ? pick(cust.setCookie, "refresh_token").split("=").slice(1).join("=") : null;
check(
  "customer refresh token cannot reach admin routes",
  ct !== null && (await call("/admin/uploads", { method: "POST", cookie: `refresh_token=${ct}`, body: {} })).status === 403,
  `login ${cust.status}: ${cust.body.message}`,
);

console.log("\n=== customer is refused admin routes but fine on /me ===");
const custLogin = await call("/login", {
  method: "POST",
  body: { email: "mike@openseller.test", password: "password123" },
});
if (custLogin.status !== 200) {
  // seed may use a different customer address; fall back to listing what we know works
  check("customer login", false, `got ${custLogin.status}: ${custLogin.body.message}`);
} else {
  const custJar = jar(custLogin.setCookie);
  const custMe = await call("/me", { cookie: custJar });
  check("/me as customer", custMe.status === 200, `got ${custMe.status}`);
  const custAdmin = await call("/admin/uploads", { cookie: custJar, method: "POST", body: {} });
  check("customer refused /admin/uploads", custAdmin.status === 403, `got ${custAdmin.status}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);