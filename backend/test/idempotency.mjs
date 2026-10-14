// Idempotency: a repeated Idempotency-Key must collapse to one execution, a recycled key with
// a different body must be refused, and a 5xx must not poison the key a client needs to retry
// with. Every mutating request the frontend makes carries one of these keys, so a regression
// here is a duplicate write in production.
//
// Drives the running stack over HTTP like a browser, which is the only way to observe the
// Idempotency-* response headers at all.
const BASE = "http://localhost/api";

const ADMIN = { email: "admin@openseller.test", password: "password123" };

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function call(path, { method = "GET", cookie, body, key, headers = {} } = {}) {
  const sent = { "Content-Type": "application/json", ...headers };
  if (cookie) sent.Cookie = cookie;
  if (key) sent["Idempotency-Key"] = key;

  const res = await fetch(BASE + path, {
    method,
    headers: sent,
    // Deliberately a plain string: JSON.stringify of the same object twice is byte-identical,
    // but the suite also sends reordered keys on purpose further down.
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

  return {
    status: res.status,
    body: parse(await res.text()),
    // The whole contract is reported in these three headers.
    state: res.headers.get("idempotency-status"),
    echo: res.headers.get("idempotency-key"),
    setCookie: res.headers.getSetCookie?.() ?? [],
  };
}

function refreshCookie(setCookie) {
  const found = setCookie.find((c) => c.startsWith("refresh_token="));
  return found ? found.split(";")[0] : null;
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

/** Unique per run so a re-run never collides with the previous run's stored records. */
const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

console.log("\n=== a request without a key is untouched by any of this ===");
const noKey = await call("/login", { method: "POST", body: ADMIN });
check("login without a key still works", noKey.status === 200, `got ${noKey.status}`);
check("no Idempotency-Status is invented", noKey.state === null, `got ${noKey.state}`);
const adminJar = noKey.setCookie.map((c) => c.split(";")[0]).join("; ");
check("cookies issued as usual", adminJar.includes("access_token"));

console.log("\n=== first use of a key executes and is recorded ===");
const storeKey = `idem${uniq()}`;
const first = await call("/login", { method: "POST", body: ADMIN, key: storeKey });
check("first request succeeds", first.status === 200, `got ${first.status}`);
check("reported as stored", first.state === "stored", `got ${first.state}`);
check("key echoed back", first.echo === storeKey, `got ${first.echo}`);
const firstRefresh = refreshCookie(first.setCookie);
check("session cookie issued", !!firstRefresh);

console.log("\n=== the same key replays instead of executing again ===");
const again = await call("/login", { method: "POST", body: ADMIN, key: storeKey });
check("replay succeeds", again.status === 200, `got ${again.status}`);
check("reported as replayed", again.state === "replayed", `got ${again.state}`);
check("identical body", JSON.stringify(again.body) === JSON.stringify(first.body));
// The real proof of a single execution: a second login would mint a new refresh token, so an
// unchanged one means the handler did not run again.
check(
  "same refresh token, so the handler ran once",
  refreshCookie(again.setCookie) === firstRefresh,
  "a second execution would have issued a different token",
);
check(
  "replay re-sets the auth cookies",
  again.setCookie.some((c) => c.startsWith("access_token=")),
  "a lost login response must still leave the client able to authenticate",
);

console.log("\n=== a recycled key with a different body is refused ===");
const mismatch = await call("/login", {
  method: "POST",
  body: { email: ADMIN.email, password: "not-the-password" },
  key: storeKey,
});
check("mismatched body is 422", mismatch.status === 422, `got ${mismatch.status}: ${mismatch.body.message}`);

console.log("\n=== key order in the body is not a mismatch ===");
// Same request, keys serialised in the other order. Hashing raw bytes would call this a
// mismatch and tell the user to use a new key for an identical action.
const reorderedKey = `idem${uniq()}`;
await call("/login", { method: "POST", body: ADMIN, key: reorderedKey });
const reordered = await call("/login", {
  method: "POST",
  body: { password: ADMIN.password, email: ADMIN.email },
  key: reorderedKey,
});
check("reordered body replays", reordered.state === "replayed", `got ${reordered.state}: ${reordered.body.message}`);

console.log("\n=== a key is not shared across users ===");
// Same key, different authenticated user. The second must not be handed the first's response.
// The profile phone is captured first so the suite can put it back at the end.
const original = await call("/profile", { cookie: adminJar });
const originalPhone = original.body?.data?.phone ?? null;
const other = await call("/login", { method: "POST", body: { email: "sarah@openseller.test", password: ADMIN.password } });
const otherKey = `idem${uniq()}`;
await call("/profile", { method: "PUT", cookie: adminJar, body: { phone: "+15550001111" }, key: otherKey });
const crossUser = await call("/profile", {
  method: "PUT",
  cookie: other.setCookie.map((c) => c.split(";")[0]).join("; "),
  body: { phone: "+15550002222" },
  key: otherKey,
});
check(
  "another principal cannot read the first's response",
  crossUser.status === 422,
  `got ${crossUser.status}: ${crossUser.body.message}`,
);

console.log("\n=== malformed keys are rejected rather than silently accepted ===");
for (const [label, bad] of [["too short", "abc"], ["illegal characters", "has spaces and $ymbols"]]) {
  const r = await call("/login", { method: "POST", body: ADMIN, key: bad });
  check(`${label} key is 400`, r.status === 400, `got ${r.status}`);
}

console.log("\n=== reads ignore the header entirely ===");
const read = await call("/products?perPage=1", { key: storeKey });
check("GET is unaffected", read.status === 200, `got ${read.status}`);
check("GET is not recorded as a replay", read.state === null, `got ${read.state}`);

console.log("\n=== concurrent duplicates collapse to one execution ===");
const raceKey = `idem${uniq()}`;
const racers = await Promise.all(
  Array.from({ length: 8 }, () => call("/login", { method: "POST", body: ADMIN, key: raceKey }))
);
const stored = racers.filter((r) => r.state === "stored");
const replayed = racers.filter((r) => r.state === "replayed");
check("exactly one execution", stored.length === 1, `${stored.length} executed`);
check("every other request replayed", replayed.length === racers.length - 1, `${replayed.length} replayed`);
check("no request errored", racers.every((r) => r.status === 200), racers.map((r) => r.status).join(","));
const tokens = new Set(racers.map((r) => refreshCookie(r.setCookie)));
check("all eight share one session", tokens.size === 1, `${tokens.size} distinct tokens`);

console.log("\n=== distinct keys are never collapsed into each other ===");
const distinct = await Promise.all([
  call("/login", { method: "POST", body: ADMIN, key: `idem${uniq()}` }),
  call("/login", { method: "POST", body: ADMIN, key: `idem${uniq()}` }),
]);
check("both execute", distinct.every((r) => r.state === "stored"), distinct.map((r) => r.state).join(","));
check(
  "each gets its own session",
  refreshCookie(distinct[0].setCookie) !== refreshCookie(distinct[1].setCookie),
);

console.log("\n=== a client error is a known outcome, so it replays rather than re-running ===");
const knownKey = `idem${uniq()}`;
const rejected = await call("/profile/password", {
  method: "PUT",
  cookie: adminJar,
  body: { currentPassword: "definitely-wrong", newPassword: "irrelevant123" },
  key: knownKey,
});
check("wrong password is refused", rejected.status === 401, `got ${rejected.status}`);
check("recorded", rejected.state === "stored", `got ${rejected.state}`);
const rejectedAgain = await call("/profile/password", {
  method: "PUT",
  cookie: adminJar,
  body: { currentPassword: "definitely-wrong", newPassword: "irrelevant123" },
  key: knownKey,
});
check("and replays", rejectedAgain.state === "replayed", `got ${rejectedAgain.state}`);

console.log("\n=== a 5xx releases the key so the retry can actually run ===");
// NOTE: this leans on an unparseable date reaching Prisma and raising. If profile validation
// lands and this returns 400 instead, this block needs a different way to provoke a 5xx --
// the contract it checks (a failed request must not burn the key) is what matters.
const failKey = `idem${uniq()}`;
const broken = await call("/profile", {
  method: "PUT",
  cookie: adminJar,
  body: { dob: "not-a-date" },
  key: failKey,
});
check("provokes a 5xx", broken.status >= 500, `got ${broken.status}`);
check("reported as released", broken.state === "released", `got ${broken.state}`);

const retried = await call("/profile", {
  method: "PUT",
  cookie: adminJar,
  body: { phone: "+15550003333" },
  key: failKey,
});
check("the same key now executes", retried.status === 200, `got ${retried.status}: ${retried.body.message}`);
check("rather than replaying the failure", retried.state === "stored", `got ${retried.state}`);

console.log("\n=== restoring the profile this suite edited ===");
const restoreKey = `idem${uniq()}`;
const restored = await call("/profile", {
  method: "PUT",
  cookie: adminJar,
  // null clears the column; any non-null value writes it back as it was found.
  body: { phone: originalPhone },
  key: restoreKey,
});
check("profile restored for later suites", restored.status === 200, `got ${restored.status}: ${restored.body.message}`);
const verify = await call("/profile", { cookie: adminJar });
check("phone is back to its seeded value", (verify.body?.data?.phone ?? null) === originalPhone, `got ${verify.body?.data?.phone}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);