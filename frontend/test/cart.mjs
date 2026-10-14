/**
 * Cart logic.
 *
 * The cart is pure client state with no server copy, so nothing else in this repo exercises it:
 * `make test` drives the API over HTTP and the cart never reaches it until Phase 4. These
 * assertions exist because the one rule the phase is actually judged by — "quantity cannot exceed
 * stock" — lives in a reducer that a browser would have to be driven to reach.
 *
 * That is why the logic lives in src/lib/cart-storage.ts with no React and no JSX: it can be
 * imported and asserted here directly. The .tsx provider is only wiring around it.
 *
 * Run with type stripping, since the module under test is TypeScript:
 *   node --experimental-strip-types frontend/test/cart.mjs
 */
import {
  addLine,
  clampQuantity,
  coerceLine,
  parseCart,
  reconcileLines,
  setLineQuantity,
  CART_STORAGE_KEY,
} from "../src/lib/cart-storage.ts";

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

/** A minimal valid line; override only the fields a given assertion is about. */
const line = (over = {}) => ({
  variantId: "v1",
  productId: "p1",
  slug: "enamelled-dutch-oven",
  title: "Enamelled Dutch Oven",
  variantName: "",
  image: "/uploads/x.svg",
  currency: "usd",
  unitPriceCents: 2500,
  quantity: 1,
  maxQuantity: 5,
  addedAt: 1000,
  ...over,
});

// --- clampQuantity: the rule the phase is judged by ---
ok("quantity below 1 clamps up to 1", clampQuantity(0, 5) === 1);
ok("negative quantity clamps up to 1", clampQuantity(-3, 5) === 1);
ok("quantity above stock clamps down to stock", clampQuantity(9, 5) === 5);
ok("quantity within stock is untouched", clampQuantity(3, 5) === 3);
ok("fractional quantity floors", clampQuantity(2.9, 5) === 2);
ok("NaN quantity becomes 1", clampQuantity(Number.NaN, 5) === 1);
// Infinity is unparseable, not "very large". Falling back to the ceiling would let one corrupt
// value order a line's entire stock, so a non-finite quantity becomes the minimum instead.
ok("Infinity quantity falls back to 1, not to the ceiling", clampQuantity(Number.POSITIVE_INFINITY, 5) === 1);
// A zero ceiling cannot be satisfied, so it is floored at 1 rather than producing a 0 that would
// render as "quantity 0" in the stepper.
ok("zero ceiling still yields 1, not 0", clampQuantity(1, 0) === 1);
ok("quantity can never exceed stock, across a sweep", (() => {
  for (let max = 1; max <= 12; max++) {
    for (const q of [-5, 0, 1, 2, 7, 99, 2.5]) {
      if (clampQuantity(q, max) > max) return false;
      if (clampQuantity(q, max) < 1) return false;
    }
  }
  return true;
})());

// --- storage key is versioned, so a shape change cannot read an old file ---
ok("storage key is versioned", /^openseller\.cart\.v\d+$/.test(CART_STORAGE_KEY));

// --- coerceLine: localStorage is user-writable and outlives deploys ---
ok("a well-formed line survives", coerceLine(line())?.title === "Enamelled Dutch Oven");
ok("a non-object is rejected", coerceLine(null) === null);
ok("a string is rejected", coerceLine("nope") === null);
ok("an array entry is rejected", coerceLine([]) === null);
ok("missing variantId is rejected", coerceLine(line({ variantId: "" })) === null);
ok("missing productId is rejected", coerceLine(line({ productId: undefined })) === null);
ok("missing slug is rejected", coerceLine(line({ slug: "" })) === null);
ok("missing title is rejected", coerceLine(line({ title: "" })) === null);
ok("missing currency is rejected", coerceLine(line({ currency: "" })) === null);
ok("NaN unit price is rejected", coerceLine(line({ unitPriceCents: Number.NaN })) === null);
ok("negative unit price is rejected", coerceLine(line({ unitPriceCents: -1 })) === null);
ok("string unit price is rejected, not coerced",
  coerceLine(line({ unitPriceCents: "2500" })) === null);
ok("zero maxQuantity is rejected", coerceLine(line({ maxQuantity: 0 })) === null);
// These two are the interesting ones: the row is kept, and only the broken field is repaired.
ok("an over-stock quantity is repaired on read", coerceLine(line({ quantity: 99 }))?.quantity === 5);
ok("a zero quantity is repaired on read", coerceLine(line({ quantity: 0 }))?.quantity === 1);
ok("a missing image becomes null, not \"undefined\"",
  coerceLine(line({ image: undefined }))?.image === null);
ok("a missing addedAt becomes 0", coerceLine(line({ addedAt: undefined }))?.addedAt === 0);

// --- parseCart ---
ok("null parses to an empty cart", parseCart(null).length === 0);
ok("empty string parses to an empty cart", parseCart("").length === 0);
ok("invalid JSON parses to an empty cart", parseCart("{not json").length === 0);
ok("a JSON object is not a cart", parseCart('{"a":1}').length === 0);
ok("a JSON string is not a cart", parseCart('"hello"').length === 0);
ok("a good row survives alongside a bad one",
  parseCart(JSON.stringify([line(), { garbage: true }, line({ variantId: "v2" })])).length === 2);
ok("everything untrusted is dropped",
  parseCart(JSON.stringify([null, 1, "x", {}, { variantId: "v" }])).length === 0);

// --- addLine: keyed by variant, so two sizes are two lines ---
const one = addLine([], line(), 2000);
ok("adding to an empty cart makes one line", one.length === 1);
ok("a new line is placed first", one[0].variantId === "v1");
ok("a new line records when it was added", one[0].addedAt === 2000);

const two = addLine(one, line({ variantId: "v2", title: "Second" }), 3000);
ok("a different variant is a second line", two.length === 2);
ok("both lines are present", two.some((l) => l.variantId === "v2"));

const topped = addLine(one, line({ quantity: 2 }), 4000);
ok("the same variant tops up rather than duplicating", topped.length === 1);
ok("topping up sums the quantities", topped[0].quantity === 3);
// Position is carried by the line's original addedAt — 2000, from when it was first added — not
// by the 4000 passed to this call. A top-up must not float the line to the top of the cart.
ok("topping up keeps the original position in the cart", topped[0].addedAt === 2000,
  `got ${topped[0].addedAt}`);

// The incoming figures are the freshly-read ones, so they must win over what was stored.
const repriced = addLine(one, line({ unitPriceCents: 3000, maxQuantity: 9 }), 5000);
ok("a re-add adopts the current price", repriced[0].unitPriceCents === 3000);
ok("a re-add adopts the current stock ceiling", repriced[0].maxQuantity === 9);

// ...but the total still respects the ceiling. This is the one that matters: topping up a line
// whose stock shrank since it was added must not produce an unorderable quantity.
const oversold = addLine(one, line({ quantity: 8, maxQuantity: 4 }), 6000);
ok("topping up cannot exceed current stock", oversold[0].quantity === 4,
  `got ${oversold[0].quantity}`);
ok("adding beyond stock still yields exactly the ceiling, not more",
  addLine([], line({ quantity: 99, maxQuantity: 3 }), 7000)[0].quantity === 3);

// --- setLineQuantity ---
const edited = setLineQuantity(one, "v1", 3);
ok("a valid quantity is applied", edited[0].quantity === 3);
ok("a quantity above stock is clamped", setLineQuantity(one, "v1", 50)[0].quantity === 5);
ok("a quantity of 0 is clamped to 1", setLineQuantity(one, "v1", 0)[0].quantity === 1);
ok("an unknown variant id changes nothing",
  setLineQuantity(one, "does-not-exist", 3)[0].quantity === 1);

// --- reconcileLines: the catalog moved under a stored cart ---
const live = new Map([
  ["v1", { priceCents: 3000, stock: 9 }],
  ["v2", { priceCents: 1000, stock: 0 }],
]);
const stored = [
  line({ variantId: "v1", quantity: 2, unitPriceCents: 2500 }),
  line({ variantId: "v2", quantity: 1, title: "Sold Out Thing" }),
  line({ variantId: "v3", quantity: 1, title: "Deleted Variant" }),
  line({ variantId: "v4", quantity: 1, slug: "gone-product", title: "Archived" }),
];

const goneSlugs = new Set(["gone-product"]);
const same = reconcileLines(stored, live, goneSlugs);
ok("reconcile keeps every line", same.lines.length === 4);
ok("a moved price is adopted", same.lines[0].unitPriceCents === 3000);
ok("stock going up raises the ceiling", same.lines[0].maxQuantity === 9);
ok("a quantity within stock is left alone", same.lines[0].quantity === 2);

ok("a sold-out variant is flagged", same.issues.v2?.reason === "Out of stock");
ok("a deleted variant is flagged as an option, not a product",
  same.issues.v3?.reason === "This option is no longer available");

ok("an archived product is flagged as a product",
  same.issues.v4?.reason === "This product is no longer available");
ok("a flagged product is not double-flagged as an option",
  same.issues.v4?.reason !== "This option is no longer available");

// The shopper's line is kept, not deleted. Dropping it silently would read as data loss, and the
// quantity they chose is information we may want if stock returns.
ok("a sold-out line is kept so the shopper can see and remove it",
  same.lines.some((l) => l.variantId === "v2"));
ok("a healthy line has no issue", same.issues.v1 === undefined);

// --- reconcile: stock shrank below the chosen quantity ---
const shrunk = new Map([["v1", { priceCents: 2500, stock: 1 }]]);
const reduced = reconcileLines(
  [line({ variantId: "v1", quantity: 4 })],
  shrunk,
  new Set()
);
ok("a quantity above current stock is reduced to it", reduced.lines[0].quantity === 1);
ok("the ceiling follows the new stock", reduced.lines[0].maxQuantity === 1);
ok("reducing to a stock of 1 is not an error state", reduced.issues.v1 === undefined);

// --- reconcile: an empty cart is a no-op, not a crash ---
const empty = reconcileLines([], live, new Set());
ok("reconciling an empty cart is safe", empty.lines.length === 0);
ok("reconciling an empty cart produces no issues", Object.keys(empty.issues).length === 0);

// --- the round trip a reload actually performs ---
const storedJson = JSON.stringify(one);
ok("a stored cart round-trips through JSON unchanged",
  JSON.stringify(parseCart(storedJson)) === storedJson);

console.log(`\n  cart: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);