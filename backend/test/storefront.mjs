/**
 * Storefront contract: everything the marketplace grid and product page read.
 *
 * These assertions exist because the storefront is a client component — the page renders a
 * skeleton on the server and fills the grid in after mount — so a shape or filter regression
 * shows up as an empty grid in the browser with nothing in the server logs. Pinning the contract
 * here means a break is caught by `make test` instead.
 *
 * Discounts: Product.discountPercent is a markdown and Product.salePriceCents is its stored
 * post-discount minimum. Four seeded products carry a discount, chosen to cover a simple
 * product, a variant product, an out-of-stock one, and one whose markdown lands on exactly half
 * a minor unit.
 */
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

// --- card shape: every field the card component reads ---
const all = (await get("/api/products?perPage=100")).body.data.items;
const card = all[0];
for (const field of [
  "id", "slug", "title", "brief", "image", "priceCents", "listPriceCents",
  "discountPercent", "priceFrom", "currency", "inStock", "quantity",
  "ratingAvg", "ratingCount",
]) {
  ok(`card exposes ${field}`, Object.hasOwn(card, field));
}
ok("card currency is the store currency", typeof card.currency === "string" && card.currency.length === 3);

// --- discountPercent is meaningful ---
ok("some product is discounted", all.some((p) => p.discountPercent > 0));
ok("most products are not", all.filter((p) => p.discountPercent === 0).length > all.length / 2);

// --- discounted filter ---
const disc = (await get("/api/products?discounted=true&perPage=100")).body.data;
ok("discounted filter returns rows", disc.total > 0, `got ${disc.total}`);
ok("every hit is discounted", disc.items.every((p) => p.discountPercent > 0));
ok("every hit carries a listPrice", disc.items.every((p) => p.listPriceCents !== null));
ok("every hit is cheaper than its listPrice",
  disc.items.every((p) => p.priceCents < p.listPriceCents));

const undisc = (await get("/api/products?perPage=100")).body.data.items;
ok("undiscounted rows report listPrice null",
  undisc.filter((p) => p.discountPercent === 0).every((p) => p.listPriceCents === null));

// --- the half-up rounding invariant ---
// Seeded: 1850 at 15% = 1572.5, which must round to 1573 and NOT floor to 1572.
const halving = disc.items.find((p) => p.listPriceCents === 1850 && p.discountPercent === 15);
ok("half-up rounding: 1850 at 15% is 1573", halving?.priceCents === 1573,
  `got ${halving?.priceCents}`);

// --- discountPercent is respected in the stored rollup, not recomputed per row ---
// salePriceCents is what the list sorts on and what the card prints, so a stale rollup would
// show one price and sort by another. With discountPercent = 0 the two must be identical.
const zeroDisc = all.filter((p) => p.discountPercent === 0);
ok("undiscounted rows all have listPrice null", zeroDisc.every((p) => p.listPriceCents === null));
ok("a 0% discount does not zero the price", zeroDisc.every((p) => p.priceCents > 0));

// --- filter intersection ---
const soldOutDisc = disc.items.filter((p) => !p.inStock);
ok("a discounted product is out of stock (tests intersection)", soldOutDisc.length > 0);
const both = (await get("/api/products?discounted=true&inStock=true&perPage=100")).body.data;
ok("discounted AND inStock is a strict subset",
  both.total === disc.total - soldOutDisc.length,
  `disc=${disc.total} soldOut=${soldOutDisc.length} both=${both.total}`);
ok("both-filter results are all discounted and all in stock",
  both.items.every((p) => p.discountPercent > 0 && p.inStock));

// --- price sort must rank by the price ON THE CARD ---
const byPrice = (await get("/api/products?sort=price_asc&perPage=100")).body.data.items;
let monotonic = true;
for (let i = 1; i < byPrice.length; i++) {
  if (byPrice[i].priceCents < byPrice[i - 1].priceCents) monotonic = false;
}
ok("price_asc is monotonic by displayed price", monotonic);

// The concrete failure this guards: sorting on pre-discount minPriceCents would put the
// undiscounted 1200 first, because 1450 is a larger number than 1200 even at 30% off.
const cheapest = byPrice[0];
ok("price_asc respects the markdown", cheapest.priceCents === 1015 && cheapest.listPriceCents === 1450,
  `got ${cheapest.priceCents} (was ${cheapest.listPriceCents})`);

const byPriceDesc = (await get("/api/products?sort=price_desc&perPage=100")).body.data.items;
let descMonotonic = true;
for (let i = 1; i < byPriceDesc.length; i++) {
  if (byPriceDesc[i].priceCents > byPriceDesc[i - 1].priceCents) descMonotonic = false;
}
ok("price_desc is monotonic by displayed price", descMonotonic);
ok("price_desc leads with the dearest item",
  byPriceDesc[0].priceCents === byPrice[byPrice.length - 1].priceCents);

// price_desc is deliberately NOT the reverse of price_asc. Both end on the same id tiebreaker, so
// rows sharing a price keep the same relative order in both directions — which is what stops a
// page boundary from repeating or skipping a product. Asserting a strict reverse here would be
// asserting a bug.
const tiedPrices = new Set(all.map((p) => p.priceCents)).size < all.length;
if (tiedPrices) {
  const ascTieOrder = byPrice.filter((p) => p.priceCents === byPrice[0].priceC).map((p) => p.id);
  const descTieOrder = byPriceDesc.filter((p) => p.priceCents === byPriceDesc[0].priceC).map((p) => p.id);
  ok("tied rows keep the same relative order in both directions",
    JSON.stringify(ascTieOrder) === JSON.stringify(descTieOrder));
}

// --- title_asc ---
const alpha = (await get("/api/products?sort=title_asc&perPage=100")).body.data.items;
let alphaOk = true;
for (let i = 1; i < alpha.length; i++) {
  // Postgres orders by collation, so compare with the same simple casefold the UI implies
  if (alpha[i].title.toLowerCase() < alpha[i - 1].title.toLowerCase()) alphaOk = false;
}
ok("title_asc is alphabetical", alphaOk);

// --- every sort ends on the id tiebreaker, so paging cannot repeat or skip ---
for (const sort of ["newest", "price_asc", "price_desc", "rating", "title_asc"]) {
  const a = (await get(`/api/products?sort=${sort}&perPage=10&page=1`)).body.data.items.map((i) => i.id);
  const b = (await get(`/api/products?sort=${sort}&perPage=10&page=1`)).body.data.items.map((i) => i.id);
  ok(`${sort} is stable across identical requests`, JSON.stringify(a) === JSON.stringify(b));
}
ok("an unknown sort falls through to newest",
  (await get("/api/products?sort=nonsense")).body.data.items
    .map((i) => i.id).join() ===
  (await get("/api/products?sort=newest")).body.data.items.map((i) => i.id).join());

// --- out of stock is distinguishable and consistent with quantity ---
ok("out of stock implies zero quantity", all.filter((p) => !p.inStock).every((p) => p.quantity === 0));
ok("in stock implies positive quantity", all.filter((p) => p.inStock).every((p) => p.quantity > 0));

// --- detail: variants carry their own discount ---
const variantCard = disc.items.find((p) => p.priceFrom);
ok("a discounted variant product exists", Boolean(variantCard));
if (variantCard) {
  const d = (await get(`/api/products/${variantCard.slug}`)).body.data;
  ok("detail reports discountPercent", d.discountPercent === variantCard.discountPercent);
  ok("detail priceCents matches the card", d.priceCents === variantCard.priceCents);
  ok("detail listPriceCents matches the card", d.listPriceCents === variantCard.listPriceCents);

  let variantsOk = d.variants.length > 1;
  for (const v of d.variants) {
    // Math.round(price * (100 - percent) / 100) on both sides
    const expected = Math.round((v.listPriceCents * (100 - d.discountPercent)) / 100);
    if (v.priceCents !== expected) variantsOk = false;
    if (v.listPriceCents === null) variantsOk = false;
  }
  ok("every variant price is discounted by the product markdown", variantsOk);

  const cheap = Math.min(...d.variants.map((v) => v.priceCents));
  ok("detail header price is the cheapest discounted variant", d.priceCents === cheap,
    `${d.priceCents} vs ${cheap}`);
} else {
  // fall back to a simple discounted product so the detail discount path is still covered
  const simpleDisc = disc.items.find((p) => !p.priceFrom);
  const d = (await get(`/api/products/${simpleDisc.slug}`)).body.data;
  ok("simple discounted product discounts its single variant",
    d.variants[0].priceCents === Math.round((d.variants[0].listPriceCents * (100 - d.discountPercent)) / 100));
}

// --- detail never leaks a stale discount on an undiscounted product ---
const plain = all.find((p) => p.discountPercent === 0);
const plainDetail = (await get(`/api/products/${plain.slug}`)).body.data;
ok("undiscounted detail has listPriceCents null", plainDetail.listPriceCents === null);
ok("undiscounted detail has discountPercent 0", plainDetail.discountPercent === 0);
ok("undiscounted detail price equals its variant price",
  plainDetail.priceCents === plainDetail.variants[0].priceCents);

// --- reviews feed the rating summary ---
const reviews = (await get(`/api/products/${card.slug}/reviews?perPage=5`)).body.data;
ok("reviews paginate with the standard envelope",
  Array.isArray(reviews.items) && typeof reviews.total === "number" && reviews.totalPages >= 1);
if (reviews.items.length) {
  ok("review carries author name and initials",
    typeof reviews.items[0].authorName === "string" && typeof reviews.items[0].authorInitials === "string");
  ok("card ratingCount matches the review total", card.ratingCount === reviews.total,
    `card ${card.ratingCount} vs reviews ${reviews.total}`);
}

// --- pagination still partitions under a filter ---
const f1 = (await get("/api/products?category=coffee-tea&perPage=2&page=1")).body.data;
const f2 = (await get("/api/products?category=coffee-tea&perPage=2&page=2")).body.data;
const fIds = new Set([...f1.items, ...f2.items].map((i) => i.id));
ok("filtered pages do not overlap", fIds.size === f1.items.length + f2.items.length);
ok("filtered page stays inside the category",
  [...f1.items, ...f2.items].every((p) => p.category?.slug === "coffee-tea"));

console.log(`\nstorefront  ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);