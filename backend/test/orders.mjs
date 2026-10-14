// Orders: the admin fulfilment actions and the checkout payment reconcile.
//
// What this suite really guards:
//
//  1. PATCH /admin/orders/:id accepts only FULFILLED and CANCELLED; every other value (most
//     importantly "PAID") is 400, because payment is a fact recorded by the party who took the
//     money, and a status endpoint that could set an order to PAID would be a way to create
//     paid orders for free.
//  2. The legal transitions are enforced against the row, with a 409 rather than a silent
//     "correction": an unpaid order cannot be delivered, a delivered or refunded order cannot
//     be cancelled, a cancelled order cannot be delivered. A repeat of the same change is an
//     idempotent 200 and writes no second timeline entry.
//  3. Status and its timeline entry land in one transaction.
//  4. POST /admin/orders/:id/refund pays money back only where money was actually taken
//     (payment = PAID), moves status and payment together so no screen can show an order as
//     refunded while its payment still reads PAID, and is a no-op the second time round.
//  5. POST /checkout/confirm — the endpoint the success page calls when a Stripe redirect
//     arrives without a webhook — requires the caller to own the order, reports exactly what
//     Stripe says (paid or not), and changes nothing while Stripe says the payment has not
//     happened.
//  6. POST /checkout/cancel — what the cancelled page calls when Stripe sends the shopper back
//     — cancels an owned, still-unpaid order in one transaction with its timeline entry, and
//     answers 200 no-ops for anything already paid or already cancelled.
//  7. Starting a new checkout cancels the same shopper's earlier unpaid one, immediately: the
//     abandoned attempt must never sit in My orders reading "Pending payment" while they pay
//     the replacement.
//
// Throwaway state is created two ways, mirroring the two ways state reaches production:
//
//  - orders in the states an admin acts on (already paid, already delivered, already refunded)
//    cannot be produced over HTTP without charging a real card, so make-order.ts writes them
//    straight into the database — the same pattern as make-account.ts — and this suite drives
//    them over HTTP like a browser would;
//  - PENDING_PAYMENT orders come from POST /checkout/session exactly as a real checkout does,
//    which is also the only way to own a real (unpaid) Stripe session for the confirm checks.
//
// Everything created here uses `orders.*@openseller.test` addresses and is swept by
// test/sweep.ts before the next `make test` run.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost/api";
const PASSWORD = "password123";
// The suite runs from the repo root (like every other suite in test/), and the container paths
// in makeOrder()/makeAccount() are relative to that.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ADMIN = { email: "admin@openseller.test", password: PASSWORD };
const SHOPPER = { email: "sarah@openseller.test", password: PASSWORD };

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
 * An order written straight into the database in the requested state (pending|paid|fulfilled|
 * refunded|cancelled). Returns { id, number, email, token }.
 */
function makeOrder(mode, sessionId) {
  const args = ["compose", "exec", "-T", "backend", "node", "/app/test/make-order.ts", mode];
  if (sessionId) args.push(sessionId);
  const proc = spawnSync("docker", args, { cwd: ROOT, encoding: "utf8" });
  if (proc.status !== 0) {
    throw new Error(`make-order ${mode} failed: ${proc.stderr || proc.stdout}`);
  }
  return JSON.parse(proc.stdout.trim().split("\n").pop());
}

/** A verified throwaway shopper, via `make test-account`-style DB write (no inbox exists). */
function makeShopper() {
  const email = `orders.own.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@openseller.test`;
  const proc = spawnSync(
    "docker",
    ["compose", "exec", "-T", "backend", "node", "/app/test/make-account.ts", email, PASSWORD],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (proc.status !== 0) {
    throw new Error(`could not create ${email}: ${proc.stderr || proc.stdout}`);
  }
  return { email };
}

/**
 * The first in-stock, un-discounted variant, found over the public catalog. Un-discounted so
 * the order total cannot be zero (a 100%-off product would be refused by checkout), and the
 * variant id must be one that actually has stock — the Dutch Oven's first size is the one the
 * paid-order backfill sold out, which taught this helper not to trust the first variant.
 */
async function firstVariant() {
  const list = await call("/products?perPage=100&inStock=true");
  for (const card of list.body.data.items) {
    const detail = (await call(`/products/${card.id}`)).body.data;
    const variant = detail?.variants?.find(
      (v) => v.inStock && v.quantity > 0 && v.priceCents > 0 && detail.discountPercent === 0,
    );
    if (variant?.id) return variant.id;
  }
  throw new Error("no in-stock product in the seeded catalog");
}

const ADDRESS = {
  recipientName: "Suite Shopper",
  line1: "1 Test Way",
  city: "Testville",
  countryCode: "US",
};

/** POST /checkout/session exactly as the checkout page does. Returns the raw response. */
async function createCheckout(email, { cookie } = {}) {
  const variantId = await firstVariant();
  return call("/checkout/session", {
    method: "POST",
    body: {
      email,
      items: [{ variantId, quantity: 1 }],
      shippingAddress: ADDRESS,
    },
    cookie,
  });
}

function timeline(detail) {
  return detail.body.data?.timeline ?? [];
}

console.log("orders: admin fulfilment + checkout confirm/cancel");

// ---------------------------------------------------------------------------
// Admin auth first: the endpoint exists for staff, and the two failures are different.
// ---------------------------------------------------------------------------
{
  const pending = makeOrder("pending");

  const anonymous = await call(`/admin/orders/${pending.id}`, { method: "PATCH", body: { status: "CANCELLED" } });
  eq(anonymous.status, 401, "PATCH without a session is 401");

  const { cookie: shopperCookie } = await login(SHOPPER.email);
  const shopper = await call(`/admin/orders/${pending.id}`, {
    method: "PATCH",
    body: { status: "CANCELLED" },
    cookie: shopperCookie,
  });
  eq(shopper.status, 403, "a shopper is refused the admin endpoint (403)");
}

// ---------------------------------------------------------------------------
// The two states an order may legally move to, and the many ways it may not.
// ---------------------------------------------------------------------------
const adminLogin = await login(ADMIN.email);
const admin = adminLogin.cookie;

{
  const paid = makeOrder("paid");

  const delivered = await call(`/admin/orders/${paid.id}`, {
    method: "PATCH",
    body: { status: "FULFILLED" },
    cookie: admin,
  });
  eq(delivered.status, 200, "delivering a paid order is 200");
  eq(delivered.body.data.status, "FULFILLED", "  and the order now reads FULFILLED");
  eq(delivered.body.data.payment, "PAID", "  payment is untouched");

  const changed = timeline(delivered).filter((e) => e.type === "status.changed");
  eq(changed.length, 1, "  one status.changed entry landed on the timeline");

  // Repeating the change is a no-op: no second entry, still 200, still the same message.
  const again = await call(`/admin/orders/${paid.id}`, {
    method: "PATCH",
    body: { status: "FULFILLED" },
    cookie: admin,
  });
  eq(again.status, 200, "repeating the deliver is 200");
  eq(again.body.message, "Order is already delivered", "  and says so");
  eq(
    timeline(again).filter((e) => e.type === "status.changed").length,
    1,
    "  no second status.changed entry",
  );

  // The delivered order now shows up under the status filter, and under its number.
  const fulfilled = await call(`/admin/orders?status=FULFILLED&perPage=100`, { cookie: admin });
  ok(
    fulfilled.body.data.items.some((o) => o.id === paid.id),
    "the delivered order appears in the FULFILLED filter",
  );
  const byNumber = await call(`/admin/orders/${paid.number}`, { cookie: admin });
  eq(byNumber.body.data.id, paid.id, "the order is also reachable by its number");
}

{
  // Unpaid rows cannot be marked delivered: that would tell the fulfilment desk something untrue.
  const pending = makeOrder("pending");

  const deliverUnpaid = await call(`/admin/orders/${pending.id}`, {
    method: "PATCH",
    body: { status: "FULFILLED" },
    cookie: admin,
  });
  eq(deliverUnpaid.status, 409, "delivering an unpaid order is 409");
  eq(deliverUnpaid.body.message, "Only a paid order can be marked delivered", "  and says why");

  // Cancelling a (unpaid) pending order is legal...
  const cancelled = await call(`/admin/orders/${pending.id}`, {
    method: "PATCH",
    body: { status: "CANCELLED" },
    cookie: admin,
  });
  eq(cancelled.status, 200, "cancelling a pending order is 200");
  eq(cancelled.body.data.status, "CANCELLED", "  and the order now reads CANCELLED");

  // ...but a cancelled order must not be resurrected by a deliver.
  const deliverCancelled = await call(`/admin/orders/${pending.id}`, {
    method: "PATCH",
    body: { status: "FULFILLED" },
    cookie: admin,
  });
  eq(deliverCancelled.status, 409, "delivering a cancelled order is 409");
}

{
  // Delivered and refunded are terminal facts; cancelling either would quietly undo reality.
  const delivered = makeOrder("fulfilled");
  const noCancelDelivered = await call(`/admin/orders/${delivered.id}`, {
    method: "PATCH",
    body: { status: "CANCELLED" },
    cookie: admin,
  });
  eq(noCancelDelivered.status, 409, "cancelling a delivered order is 409");

  const refunded = makeOrder("refunded");
  const noCancelRefunded = await call(`/admin/orders/${refunded.id}`, {
    method: "PATCH",
    body: { status: "CANCELLED" },
    cookie: admin,
  });
  eq(noCancelRefunded.status, 409, "cancelling a refunded order is 409");
}

{
  // Cancelling a PAID order is allowed (a store can run out of stock after taking the money),
  // but cancelling does not move the money either — so an admin-only note has to say the
  // customer is owed one. The refund endpoint below is how that debt is actually paid.
  const paid = makeOrder("paid");

  const cancelled = await call(`/admin/orders/${paid.id}`, {
    method: "PATCH",
    body: { status: "CANCELLED" },
    cookie: admin,
  });
  eq(cancelled.status, 200, "cancelling a paid order is 200");
  eq(cancelled.body.data.payment, "PAID", "  the payment record is kept");

  const note = timeline(cancelled).find((e) => e.type === "note.added");
  ok(!!note, "  a note.added entry explains the refund is owed");
  eq(note?.adminOnly, true, "  and it is admin-only");
  ok(
    /refund/i.test(note?.note ?? ""),
    `  and it mentions a refund (${note?.note})`,
  );

  const again = await call(`/admin/orders/${paid.id}`, {
    method: "PATCH",
    body: { status: "CANCELLED" },
    cookie: admin,
  });
  eq(again.body.message, "Order is already cancelled", "repeating the cancel is a 200 no-op");
  eq(
    timeline(again).filter((e) => e.type === "status.changed").length,
    timeline(cancelled).filter((e) => e.type === "status.changed").length,
    "  and writes no second status.changed entry",
  );
}

// ---------------------------------------------------------------------------
// The refund endpoint: money back, never a mint of money that was never taken.
// ---------------------------------------------------------------------------
{
  const pending = makeOrder("pending");

  const anonymous = await call(`/admin/orders/${pending.id}/refund`, { method: "POST" });
  eq(anonymous.status, 401, "refund without a session is 401");

  const { cookie: shopperCookie } = await login(SHOPPER.email);
  const shopper = await call(`/admin/orders/${pending.id}/refund`, {
    method: "POST",
    cookie: shopperCookie,
  });
  eq(shopper.status, 403, "a shopper is refused the refund endpoint (403)");

  const refundUnpaid = await call(`/admin/orders/${pending.id}/refund`, {
    method: "POST",
    cookie: admin,
  });
  eq(refundUnpaid.status, 409, "refunding an unpaid order is 409");
  eq(
    refundUnpaid.body.message,
    "Only a paid order can be refunded",
    "  and says why",
  );

  const paid = makeOrder("paid");
  const refunded = await call(`/admin/orders/${paid.id}/refund`, {
    method: "POST",
    cookie: admin,
  });
  eq(refunded.status, 200, "refunding a paid order is 200");
  eq(refunded.body.data.status, "REFUNDED", "  the order reads REFUNDED");
  eq(refunded.body.data.payment, "REFUNDED", "  and the payment does too");

  const issued = timeline(refunded).filter((e) => e.type === "refund.issued");
  eq(issued.length, 1, "  one refund.issued entry landed on the timeline");

  // A second click must not pay twice or clutter the customer's timeline.
  const again = await call(`/admin/orders/${paid.id}/refund`, {
    method: "POST",
    cookie: admin,
  });
  eq(again.status, 200, "repeating the refund is a 200 no-op");
  eq(again.body.message, "Order is already refunded", "  and says so");
  eq(
    timeline(again).filter((e) => e.type === "refund.issued").length,
    1,
    "  no second refund entry",
  );

  const noCancel = await call(`/admin/orders/${paid.id}`, {
    method: "PATCH",
    body: { status: "CANCELLED" },
    cookie: admin,
  });
  eq(noCancel.status, 409, "cancelling the refunded order is 409");

  // A delivered order can still be refunded: the goods came back, the money goes back.
  const delivered = makeOrder("fulfilled");
  const refundDelivered = await call(`/admin/orders/${delivered.id}/refund`, {
    method: "POST",
    cookie: admin,
  });
  eq(refundDelivered.status, 200, "refunding a delivered order is 200");
  eq(refundDelivered.body.data.status, "REFUNDED", "  and it reads REFUNDED");
}

// ---------------------------------------------------------------------------
// The status endpoint refuses everything except FULFILLED and CANCELLED — payment
// especially, since an admin PATCH that could set PAID would mint paid orders for free.
// ---------------------------------------------------------------------------
{
  const pending = makeOrder("pending");
  const patch = (body) =>
    call(`/admin/orders/${pending.id}`, { method: "PATCH", body, cookie: admin });

  for (const [body, label] of [
    [{ status: "PAID" }, "status PAID is refused (payment not writable by admins)"],
    [{ status: "REFUNDED" }, "status REFUNDED is refused"],
    [{ status: "bogus" }, "an unknown status is refused"],
    [{}, "an empty body is refused"],
    [{ status: "" }, "an empty status is refused"],
  ]) {
    const r = await patch(body);
    eq(r.status, 400, `${label} (${r.status})`);
    ok(
      /FULFILLED \(delivered\) or CANCELLED/.test(r.body.message ?? ""),
      `  and names the only two legal values (${r.body.message})`,
    );
  }

  const untouched = await call(`/admin/orders/${pending.id}`, { cookie: admin });
  eq(untouched.body.data.status, "PENDING_PAYMENT", "the order survived every refusal unchanged");
}

// ---------------------------------------------------------------------------
// List filters validate their enums, so a typo is a 400 and not a 500.
// ---------------------------------------------------------------------------
{
  const badStatus = await call("/admin/orders?status=PENDING", { cookie: admin });
  eq(badStatus.status, 400, "an unknown status filter is 400");
  eq(badStatus.body.message, "Unknown status filter", "  and says so");

  const badPayment = await call("/admin/orders?payment=COMPLETED", { cookie: admin });
  eq(badPayment.status, 400, "an unknown payment filter is 400");

  const paid = await call("/admin/orders?status=PAID&perPage=100", { cookie: admin });
  ok(
    paid.status === 200 && paid.body.data.items.every((o) => o.status === "PAID"),
    "the PAID filter returns only PAID rows",
  );

  const unpaid = await call("/admin/orders?payment=UNPAID&perPage=100", { cookie: admin });
  ok(
    unpaid.status === 200 && unpaid.body.data.items.every((o) => o.payment === "UNPAID"),
    "the UNPAID payment filter returns only UNPAID rows",
  );
}

// ---------------------------------------------------------------------------
// Detail: 404 for a missing order, and no profile leakage on a guest order.
// ---------------------------------------------------------------------------
{
  const missing = await call("/admin/orders/999999999", { cookie: admin });
  eq(missing.status, 404, "a missing order is 404");

  const guest = makeOrder("pending");
  const detail = await call(`/admin/orders/${guest.id}`, { cookie: admin });
  eq(detail.status, 200, "guest order detail is 200");
  eq(detail.body.data.profileId, null, "  a guest order has no profile");
  eq(detail.body.data.buyerName, null, "  and no buyer name");
  eq(detail.body.data.email, guest.email, "  but its guest email is exposed");
  eq(detail.body.data.itemCount, 1, "  and its single item counts as one");
}

// ---------------------------------------------------------------------------
// POST /checkout/confirm — the reconcile the success page runs when a Stripe redirect
// arrives without a webhook. The shape checks and the 404 happen before anybody is asked,
// and confirming that someone else's session exists is treated as if it did not.
// ---------------------------------------------------------------------------
{
  const noBody = await call("/checkout/confirm", { method: "POST", body: {} });
  eq(noBody.status, 400, "confirm with no body is 400");

  const badId = await call("/checkout/confirm", {
    method: "POST",
    body: { sessionId: "not-a-stripe-id" },
  });
  eq(badId.status, 400, "confirm with a malformed session id is 400");

  const unknown = await call("/checkout/confirm", {
    method: "POST",
    body: { sessionId: "cs_test_0000000000000000000000000000000" },
  });
  eq(unknown.status, 404, "confirm for a session no order holds is 404");
}

// ---------------------------------------------------------------------------
// POST /checkout/cancel — the cancelled page telling the server which order died with the
// payment attempt. Same rules as confirm: the id only finds the row, ownership must be proved,
// and everything already resolved is a 200 no-op rather than an error the page would have to
// swallow anyway.
// ---------------------------------------------------------------------------
{
  const noBody = await call("/checkout/cancel", { method: "POST", body: {} });
  eq(noBody.status, 400, "cancel with no body is 400");

  const badId = await call("/checkout/cancel", {
    method: "POST",
    body: { orderId: "not-a-uuid" },
  });
  eq(badId.status, 400, "cancel with a malformed order id is 400");

  const unknown = await call("/checkout/cancel", {
    method: "POST",
    body: { orderId: "99999999-9999-4999-8999-999999999999" },
  });
  eq(unknown.status, 404, "cancel for an order nobody holds is 404");

  const pending = makeOrder("pending");

  const noToken = await call("/checkout/cancel", {
    method: "POST",
    body: { orderId: pending.id },
  });
  eq(noToken.status, 404, "cancel without the guest token is 404 (no ownership proof)");

  const wrongToken = await call("/checkout/cancel", {
    method: "POST",
    body: { orderId: pending.id },
    headers: { "x-guest-token": "not-the-token" },
  });
  eq(wrongToken.status, 404, "cancel with the wrong guest token is 404");

  const cancelled = await call("/checkout/cancel", {
    method: "POST",
    body: { orderId: pending.id },
    headers: { "x-guest-token": pending.token },
  });
  eq(cancelled.status, 200, "the owner cancelling an unpaid checkout is 200");
  eq(cancelled.body.data.status, "CANCELLED", "  and the order now reads CANCELLED");
  eq(cancelled.body.data.payment, "UNPAID", "  with no payment invented or moved");

  const detail = await call(`/admin/orders/${pending.id}`, { cookie: admin });
  const entries = timeline(detail).filter((e) => e.type === "status.changed");
  eq(entries.length, 1, "  one status.changed entry landed on the timeline");
  ok(
    /checkout/i.test(entries[0]?.note ?? ""),
    `  and it says the checkout was cancelled (${entries[0]?.note})`,
  );

  // A repeat must still look like success: the page may retry, and a shopper who cancelled
  // twice has still cancelled.
  const again = await call("/checkout/cancel", {
    method: "POST",
    body: { orderId: pending.id },
    headers: { "x-guest-token": pending.token },
  });
  eq(again.status, 200, "repeating the cancel is 200");
  eq(again.body.message, "Order is already cancelled", "  and says so");
  const detailAgain = await call(`/admin/orders/${pending.id}`, { cookie: admin });
  eq(
    timeline(detailAgain).filter((e) => e.type === "status.changed").length,
    1,
    "  and writes no second status.changed entry",
  );

  // Money already taken is never cancelled by leaving Checkout — that is what refunds are for.
  const paid = makeOrder("paid");
  const paidCancel = await call("/checkout/cancel", {
    method: "POST",
    body: { orderId: paid.id },
    headers: { "x-guest-token": paid.token },
  });
  eq(paidCancel.status, 200, "cancel on an already-paid order answers 200");
  eq(paidCancel.body.data.status, "PAID", "  and leaves it paid");
}

// The checks below need Stripe to be reachable from the server (a real, unpaid Checkout
// session created by this run; a bogus one the server must fail to verify). On a box with no
// STRIPE_SECRET_KEY, checkout answers first, so probe it (a couple of times — a single
// transient Stripe blip must not silently disable the most valuable checks in the suite)
// and skip only what genuinely cannot run.
async function probeStripe() {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const r = await createCheckout(`orders.probe.${Date.now()}.${attempt}@openseller.test`);
      if (r.status === 201 && r.body.data?.mock === false) return true;
      last = `status ${r.status}: ${r.body.message ?? r.body.error}`;
    } catch (error) {
      last = String(error?.message ?? error);
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
  }
  console.log(`  (Stripe probe failed ${last}; skipping Stripe-dependent confirm checks)`);
  return false;
}

const stripeActive = await probeStripe();

if (!stripeActive) {
  console.log("  (Stripe not configured on this server; skipping Stripe-dependent confirm checks)");
} else {
  // --- ownership is a prerequisite ----------------------------------------
  // The session id never appears in the checkout response — it is embedded in the success_url
  // Stripe redirects to — so read it back from the order row, exactly where a browser ends up
  // pointing anyway.
  const checkout = await createCheckout(`orders.guest.${Date.now()}@openseller.test`);
  const sessionRow = await call(`/admin/orders/${checkout.body.data.orderId}`, { cookie: admin });
  const sessionId = sessionRow.body.data.stripeCheckoutSessionId;
  ok(/^cs_[A-Za-z0-9_]+$/.test(sessionId), "the guest order holds a real Stripe session id");

  const noToken = await call("/checkout/confirm", {
    method: "POST",
    body: { sessionId },
  });
  eq(noToken.status, 404, "confirm without the guest token is 404 (no ownership proof)");

  const wrongToken = await call("/checkout/confirm", {
    method: "POST",
    body: { sessionId },
    headers: { "x-guest-token": "not-the-token" },
  });
  eq(wrongToken.status, 404, "confirm with the wrong guest token is 404");

  const rightToken = await call("/checkout/confirm", {
    method: "POST",
    body: { sessionId },
    headers: { "x-guest-token": checkout.body.data.guestToken },
  });
  eq(rightToken.status, 200, "confirm with the guest token is 200");
  eq(rightToken.body.data.paid, false, "  and reports the session is not paid");
  eq(rightToken.body.data.status, "PENDING_PAYMENT", "  order status is unchanged");
  eq(rightToken.body.data.payment, "UNPAID", "  payment is unchanged");
  eq(rightToken.body.message, "The payment has not been confirmed yet", "  and says so plainly");

  // --- a verified account whose address matches the guest email also owns it --
  // (branch 3 of callerOwnsOrder: checkout runs ahead of the auth guard, so signed-in
  // shoppers' orders usually carry profileId null and the email instead)
  const shopper = makeShopper();
  const guestCheckout = await createCheckout(shopper.email);
  const guestSessionId = (
    await call(`/admin/orders/${guestCheckout.body.data.orderId}`, { cookie: admin })
  ).body.data.stripeCheckoutSessionId;
  const { cookie: ownCookie } = await login(shopper.email);
  const verified = await call("/checkout/confirm", {
    method: "POST",
    body: { sessionId: guestSessionId },
    cookie: ownCookie,
  });
  eq(verified.status, 200, "a verified account matching the guest email owns the order");
  eq(verified.body.data.paid, false, "  and still only reports what Stripe says");

  // --- the server must own up to not being able to verify, rather than guess ---------
  // A session id with the right shape but nothing behind it on Stripe's side is a 502, not
  // "not paid": an unreachable Stripe must never be reported to the customer as a payment
  // that did not happen.
  const bogusSession = `cs_test_bogus_${Math.random().toString(36).slice(2, 10)}`;
  const bogus = makeOrder("pending", bogusSession);
  const unreach = await call("/checkout/confirm", {
    method: "POST",
    body: { sessionId: bogusSession },
    headers: { "x-guest-token": bogus.token },
  });
  // 502, not "not paid": an unreachable Stripe must never be reported to the customer as a
  // payment that did not happen. (The message is the generic one — the error handler masks all
  // 5xx text server-side and logs the real reason.)
  eq(unreach.status, 502, "an owned session Stripe does not know is 502");
  eq(unreach.body.error, true, "  and is reported as an error, not as an unpaid order");

  // The bogus session row is left PENDING_PAYMENT — the 502 must not have changed it.
  const still = await call(`/admin/orders/${bogus.id}`, { cookie: admin });
  eq(still.body.data.status, "PENDING_PAYMENT", "the 502 left the order pending");
}

// ---------------------------------------------------------------------------
// A new checkout supersedes the shopper's earlier one. This is the fix for the bug as
// reported: a shopper who abandoned Checkout and re-checked-out saw the abandoned attempt in
// My orders as "Pending payment" — an order they considered cancelled — because the sweep that
// would have cancelled it insisted on an hour of age first. The new attempt is the signal;
// seconds is enough.
// ---------------------------------------------------------------------------
{
  const buyer = makeShopper();
  const { cookie: buyerCookie } = await login(buyer.email);

  const first = await createCheckout(buyer.email, { cookie: buyerCookie });
  if (first.status !== 201) {
    // No Stripe and no mock payments on this box: checkout cannot produce an order at all, so
    // there is nothing for the sweep to cancel and nothing to assert.
    console.log(`  (skipping the supersede checks: checkout answered ${first.status} here)`);
  } else {
    const second = await createCheckout(buyer.email, { cookie: buyerCookie });
    eq(second.status, 201, "a second checkout is created while the first is unpaid");

    const history = await call("/orders", { cookie: buyerCookie });
    const row = (id) => history.body.data.items.find((o) => o.id === id);
    eq(
      row(first.body.data.orderId)?.status,
      "CANCELLED",
      "the abandoned first checkout now reads CANCELLED, not Pending payment",
    );
    eq(
      row(second.body.data.orderId)?.status,
      "PENDING_PAYMENT",
      "  the replacement is the one still awaiting payment",
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);