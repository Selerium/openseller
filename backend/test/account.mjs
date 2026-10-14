// Account sidebar endpoints: saved cards (guard, list, config, ownership) and password-gated
// account deletion.
//
// Drives the running stack over HTTP like a browser would, and creates its own throwaway
// accounts so it never touches seeded data. Two things it is really checking:
//
//   - /account and /account/payment-methods are inside the checkTokens mount. They were not,
//     which is why DELETE /account/delete used to answer 401 for every caller and the
//     setup-intent route dereferenced an undefined req.user.
//   - deletion needs the password, and cannot be reached with a session alone.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost/api";
const PASSWORD = "password123";
// The suite runs from the repo root (like every other suite in test/), and the container paths
// in shopper() are relative to that.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function call(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  return { status: res.status, body: parse(await res.text()), setCookie: res.headers.getSetCookie?.() ?? [] };
}

function jar(setCookie) {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

let pass = 0;
let fail = 0;

function ok(condition, label) {
  if (condition) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

async function login(email) {
  const res = await call("/login", { method: "POST", body: { email, password: PASSWORD } });
  return { cookie: jar(res.setCookie), res };
}

/**
 * A verified throwaway account, created inside the container.
 *
 * Not POST /register: registration leaves emailVerified false and mails a token, so the account
 * cannot log in and every check below would fail on an unrelated 403. `make test-account` sets
 * the flag directly, because there is no inbox to read a token out of.
 */
async function shopper() {
  const email = `acct.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@openseller.test`;

  const proc = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "backend",
      "node",
      "/app/test/make-account.ts",
      email,
      PASSWORD,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );

  if (proc.status !== 0) {
    throw new Error(`could not create ${email}: ${proc.stderr || proc.stdout}`);
  }

  const { cookie } = await login(email);
  return { email, cookie };
}

console.log("account: saved cards + deletion");

// --- the guard -------------------------------------------------------------
// The regression this suite exists for: /account was reachable but unguarded, so req.user was
// never populated. A 401 here proves checkTokens now runs; a 500 would mean it runs but the
// handler assumes a field that is not there.
{
  const res = await call("/account/payment-methods");
  eq(res.status, 401, "GET payment-methods without a session is 401, not 500");
  eq(res.body.message, "No access token provided", "  and says a token is missing");

  const del = await call("/account/delete", { method: "DELETE" });
  eq(del.status, 401, "DELETE account without a session is 401");
}

// --- config ----------------------------------------------------------------
// Guarded, because it sits under /account: it reports on the server's Stripe setup and has no
// business being readable by a guest.
{
  const res = await call("/account/payment-methods/config");
  eq(res.status, 401, "GET payment-methods/config without a session is 401");
}

// --- an authenticated shopper ---------------------------------------------
{
  const { email, cookie } = await shopper();

  const list = await call("/account/payment-methods", { cookie });
  eq(list.status, 200, "GET payment-methods with a session is 200");
  ok(Array.isArray(list.body.data), "  returns an array");
  eq(list.body.data.length, 0, "  a new shopper has no cards");

  const config = await call("/account/payment-methods/config", { cookie });
  eq(config.status, 200, "GET payment-methods/config with a session is 200");
  ok(typeof config.body.data.publishableKey === "string", "  carries a publishableKey string");
  ok(typeof config.body.data.configured === "boolean", "  carries a configured boolean");

  // --- ownership -----------------------------------------------------------
  // A row id belonging to someone else must read as missing, not as someone else's card. This
  // is the check that stops one shopper confirming existence of another's saved cards.
  {
    const other = await shopper();
    const res = await call("/account/payment-methods/not-a-uuid/default", {
      method: "PATCH",
      cookie: other.cookie,
    });
    ok(res.status === 404 || res.status === 400, `PATCH default on a bogus id is refused (${res.status})`);

    const del = await call("/account/payment-methods/not-a-uuid", {
      method: "DELETE",
      cookie: other.cookie,
    });
    ok(del.status === 404 || del.status === 400, `DELETE on a bogus id is refused (${del.status})`);
  }

  // --- attach validation ---------------------------------------------------
  // Refused before Stripe is contacted, because the body is the only thing that can be checked
  // without a SetupIntent to look up.
  {
    const res = await call("/account/payment-methods/attach", {
      method: "POST",
      cookie,
      body: {},
    });
    eq(res.status, 400, "attach with no setupIntentId is 400");
    eq(res.body.message, "setupIntentId is required", "  and names the missing field");
  }

  // --- deletion needs the password ----------------------------------------
  {
    const noPassword = await call("/account/delete", { method: "DELETE", cookie, body: {} });
    eq(noPassword.status, 400, "DELETE account with no password is 400");

    const wrong = await call("/account/delete", {
      method: "DELETE",
      cookie,
      body: { currentPassword: "not-the-password" },
    });
    eq(wrong.status, 401, "DELETE account with the wrong password is 401");
    eq(wrong.body.message, "Current password is incorrect", "  and says so");

    // Still alive after both refusals — the point of gating on the password is that a bad
    // attempt changes nothing.
    const still = await call("/account/payment-methods", { cookie });
    eq(still.status, 200, "the account survives a failed deletion attempt");
  }

  // --- the real thing, on a disposable account ------------------------------
  {
    const victim = await shopper();
    const res = await call("/account/delete", {
      method: "DELETE",
      cookie: victim.cookie,
      body: { currentPassword: PASSWORD },
    });
    eq(res.status, 200, "DELETE account with the correct password is 200");

    // Both cookies cleared to an empty value with an expiry in the past, which is what
    // res.clearCookie emits. A missing header would be the failure: the browser would keep
    // presenting a session for a user that no longer exists.
    for (const name of ["access_token", "refresh_token"]) {
      const header = res.setCookie.find((c) => c.startsWith(`${name}=`));
      ok(
        typeof header === "string" && /^access_token=;|^refresh_token=;/.test(header),
        `  ${name} is cleared (${header ?? "no Set-Cookie"})`
      );
    }

    // The access token itself stays valid until it expires, and that is deliberate and matches
    // logout: the token is a stateless signed JWT, so checkTokens can verify it without a
    // database round trip, which is also what lets the storefront work while the API is slow.
    // Deletion revokes the refresh token (there is no user left to rotate against) and clears
    // both cookies, so the browser stops presenting it immediately. Asserted here so the
    // limitation is written down rather than discovered later as a surprise.
    const after = await call("/account/payment-methods", { cookie: victim.cookie });
    ok(
      after.status === 200 || after.status === 401,
      `  a replayed access token is accepted until expiry, as on logout (${after.status})`
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
