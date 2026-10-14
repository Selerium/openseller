const B = "http://localhost";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const get = async (p) => {
  const r = await fetch(B + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};

// --- pagination: pages must partition the result set with no overlap ---
const p1 = (await get("/api/products?perPage=10&page=1")).body.data;
const p2 = (await get("/api/products?perPage=10&page=2")).body.data;
const p3 = (await get("/api/products?perPage=10&page=3")).body.data;
ok("24 listed products", p1.total === 24, `got ${p1.total}`);
ok("totalPages = 3", p1.totalPages === 3, `got ${p1.totalPages}`);
const ids = new Set([...p1.items, ...p2.items, ...p3.items].map((i) => i.id));
ok("pages do not overlap", ids.size === 24, `unique ${ids.size}`);
ok("page 4 is empty", (await get("/api/products?perPage=10&page=4")).body.data.items.length === 0);

// --- perPage clamp ---
const clamped = (await get("/api/products?perPage=9999")).body.data;
ok("perPage clamps to 100", clamped.perPage === 100, `got ${clamped.perPage}`);

// --- draft/archived never leak ---
const all = (await get("/api/products?perPage=100")).body.data.items;
const listed = (await get("/api/products?perPage=100")).body.data.total;
ok("only 24 of 27 products listed", listed === 24 && all.length === 24);

// --- filters ---
const searched = (await get("/api/products?search=matcha")).body.data;
ok("search narrows results", searched.total > 0 && searched.total < 24, `got ${searched.total}`);
const inStock = (await get("/api/products?inStock=true")).body.data;
ok("inStock filter excludes empties", inStock.items.every((p) => p.inStock));
ok("some product is out of stock", all.some((p) => !p.inStock));

// --- product detail + variants ---
const withVariants = all.find((p) => p.priceFrom);
ok("a variant product exists", Boolean(withVariants));
if (withVariants) {
  const d = (await get(`/api/products/${withVariants.slug}`)).body.data;
  ok("variant product has >1 variant", d.variants.length > 1, `got ${d.variants.length}`);
  ok("variant product reports priceFrom", d.priceFrom === true);
  ok("no sku leaked to public", !JSON.stringify(d).includes('"sku"'));
}
const simple = all.find((p) => !p.priceFrom);
if (simple) {
  const d = (await get(`/api/products/${simple.slug}`)).body.data;
  ok("simple product has one Default variant", d.variants.length === 1 && d.variants[0].name === "Default");
}

// --- category filter ---
const cats = (await get("/api/categories")).body.data;
ok("4 categories", cats.length === 4, `got ${cats.length}`);
const cat = cats[0];
const byCat = (await get(`/api/products?category=${cat.slug}`)).body.data;
ok("category filter returns members", byCat.total > 0 && byCat.total < 24, `got ${byCat.total}`);
ok("all results in that category", byCat.items.every((p) => p.category.slug === cat.slug));

// --- reviews ---
const rated = all.find((p) => p.ratingCount > 0);
const revs = (await get(`/api/products/${rated.slug}/reviews`)).body.data;
ok("reviews paginate", typeof revs.total === "number" && Array.isArray(revs.items));
ok("every review has an author name", revs.items.every((r) => typeof r.authorName === "string" && r.authorName.length > 0));
ok("every review has initials", revs.items.every((r) => typeof r.authorInitials === "string"));
ok("19 reviews seeded in total", (await get(`/api/products?perPage=100`)).body.data.items.reduce((n, p) => n + p.ratingCount, 0) === 19, `got ${all.reduce((n, p) => n + p.ratingCount, 0)}`);

// --- auth still works end to end ---
const login = await fetch(B + "/api/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@openseller.test", password: "password123" }),
});
ok("admin login 200", login.status === 200, `got ${login.status}`);
const jar = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
ok("both cookies set", jar.includes("access_token") && jar.includes("refresh_token"));
const me = await fetch(B + "/api/me", { headers: { cookie: jar } });
ok("GET /api/me 200", me.status === 200, `got ${me.status}`);

// --- money renders as letters ---
const d = (await get(`/api/products/${all[0].slug}`)).body.data;
ok("card carries a currency code", typeof d.currency === "string" && d.currency === "usd");

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
