const B = "http://localhost";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${e}`)); };

// 1. The auth surface must not leak commerce data.
const login = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "sarah@openseller.test", password: "password123" }) });
const jar = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const me = await (await fetch(B + "/api/me", { headers: { cookie: jar } })).json();
const m = JSON.stringify(me);
ok("login works", login.status === 200, `got ${login.status}`);
ok("/me has no orders", !m.includes('"orders"'));
ok("/me has no addresses", !m.includes('"addresses"'));
ok("/me has no reviews", !m.includes('"reviews"'));
ok("/me has no paymentMethods", !m.includes('"paymentMethods"'));
ok("/me has no complaints", !m.includes('"complaints"'));
ok("/me has no stripeCustomerId", !m.includes('"stripeCustomerId"'));
ok("/me does carry auth identity", m.includes('"email"') && m.includes('"role"'));

// 2. Public detail must not leak the Profile-owned relations.
const p = await (await fetch(B + "/api/products")).json();
const slug = p.data.items[0].slug;
const d = await (await fetch(`${B}/api/products/${slug}`)).json();
const dj = JSON.stringify(d);
ok("public product leaks no orders/reviews keys", !/profileId|"userId"/.test(dj));
ok("public product leaks no stripe ids", !dj.includes("stripeCustomerId"));

// 3. Non-admin must be refused from admin routes.
for (const path of ["/api/admin/products", "/api/admin/uploads"]) {
  const anon = await fetch(B + path);
  ok(`anon ${path} refused`, anon.status === 401, `got ${anon.status}`);
  const cust = await fetch(B + path, { headers: { cookie: jar } });
  ok(`customer ${path} refused`, cust.status === 403, `got ${cust.status}`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
