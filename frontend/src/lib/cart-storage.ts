/**
 * Cart storage: the pure half of the cart.
 *
 * Deliberately free of React and of JSX so it can be imported and asserted directly by
 * backend/test/cart.mjs under plain node's type stripping. Everything here is a total function of
 * its input, which is what makes the awkward cases — a half-written row, a hand-edited file, a
 * deploy that changed the shape — assertable rather than merely hoped about.
 *
 * See cart-context.tsx for the React side and for why the cart holds no server copy.
 */

export interface CartLine {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  /** Empty for a simple single-variant product; "Default" is noise in a cart line. */
  variantName: string;
  image: string | null;
  currency: string;
  /** Post-discount. A display cache, never what gets charged. */
  unitPriceCents: number;
  quantity: number;
  /** Stock as last seen. Clamps the stepper when no live figure is available. */
  maxQuantity: number;
  addedAt: number;
}

export interface AddLineInput {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  variantName: string;
  image: string | null;
  currency: string;
  unitPriceCents: number;
  quantity: number;
  maxQuantity: number;
}

/**
 * Why a line cannot be bought. Non-blocking conditions (a price that moved, a quantity that had
 * to come down) are resolved silently in the shopper's favour and reported as a toast; only the
 * cases where the line cannot be sold at all end up here, and those block checkout.
 */
export interface CartIssue {
  reason: string;
}

export const CART_STORAGE_KEY = "openseller.cart.v1";

/**
 * Forces an integer in [1, max]. A quantity is never 0 and never fractional.
 *
 * `max` is floored at 1 rather than allowed to reach 0. A zero ceiling means the variant cannot be
 * bought at all, which is a state the caller has to say out loud ("Out of stock") — silently
 * pinning a stepper at 1 would offer a quantity that cannot be ordered.
 */
export function clampQuantity(quantity: number, max: number): number {
  const wanted = Math.floor(Number.isFinite(quantity) ? quantity : 1);
  return Math.min(Math.max(wanted, 1), Math.max(max, 1));
}

/**
 * Turns one untrusted value into a line, or rejects it.
 *
 * localStorage is writable by the user and survives deploys, so every field is treated as hostile.
 * A line missing an identity or a usable number is dropped rather than repaired: a repaired line
 * with an invented variant id would produce a cart that renders and then cannot be checked out.
 */
export function coerceLine(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const finite = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : Number.NaN;

  const variantId = text(r.variantId);
  const productId = text(r.productId);
  const slug = text(r.slug);
  const title = text(r.title);
  const currency = text(r.currency);
  const unitPriceCents = finite(r.unitPriceCents);
  const maxQuantity = finite(r.maxQuantity);

  // These five identify the line and price it. Without them there is nothing to link to and
  // nothing to total.
  if (!variantId || !productId || !slug || !title || !currency) return null;
  if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) return null;
  // A stored max below 1 means the row was saved against zero stock, or was hand-edited.
  if (!Number.isFinite(maxQuantity) || maxQuantity < 1) return null;

  return {
    variantId,
    productId,
    slug,
    title,
    variantName: text(r.variantName),
    image: typeof r.image === "string" ? r.image : null,
    currency,
    unitPriceCents,
    quantity: clampQuantity(finite(r.quantity), maxQuantity),
    maxQuantity,
    addedAt: finite(r.addedAt) || 0,
  };
}

/** Parses a stored payload, discarding only the rows that cannot be trusted. */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const lines: CartLine[] = [];
  for (const entry of parsed) {
    const line = coerceLine(entry);
    if (line !== null) lines.push(line);
  }
  return lines;
}

/**
 * Adds a line, or tops up the one already holding that variant.
 *
 * The incoming figures win over the stored ones because they were just read from the catalog, and
 * the target is the sum of what was there and what was asked for. A cart keyed by variant is what
 * makes two different sizes of the same product two lines rather than one ambiguous one.
 */
export function addLine(lines: CartLine[], input: AddLineInput, now: number): CartLine[] {
  const existing = lines.find((line) => line.variantId === input.variantId);

  if (!existing) {
    return [
      { ...input, quantity: clampQuantity(input.quantity, input.maxQuantity), addedAt: now },
      // Newest first: the line just added is the one the shopper is looking at.
      ...lines,
    ];
  }

  const wanted = existing.quantity + input.quantity;
  return lines.map((line) =>
    line.variantId === input.variantId
      ? {
          ...line,
          ...input,
          quantity: clampQuantity(wanted, input.maxQuantity),
          // Keep the original position: topping up should not shuffle the cart.
          addedAt: line.addedAt,
        }
      : line
  );
}

/** Applies a quantity change to one line, clamped to that line's ceiling. */
export function setLineQuantity(
  lines: CartLine[],
  variantId: string,
  quantity: number
): CartLine[] {
  return lines.map((line) =>
    line.variantId === variantId
      ? { ...line, quantity: clampQuantity(quantity, line.maxQuantity) }
      : line
  );
}

/**
 * Folds live catalog figures back into stored lines.
 *
 * Pure, so the whole reconciliation is assertable without a network. `live` maps variantId to the
 * current price and stock; `gone` holds slugs the public catalog no longer serves at all.
 *
 * Two deliberate choices:
 *
 *   - A line that cannot be sold is *kept* and reported, not deleted. Silently dropping something
 *     a shopper deliberately added reads as data loss, and they may want to know why it vanished
 *     before removing it themselves.
 *   - A price that moved is adopted rather than flagged as an error. The backend re-prices at
 *     checkout regardless, so showing the old figure would guarantee a surprise at the payment step.
 *     A quantity above the new stock is quietly reduced for the same reason.
 */
export function reconcileLines(
  lines: CartLine[],
  live: Map<string, { priceCents: number; stock: number }>,
  gone: Set<string>
): { lines: CartLine[]; issues: Record<string, CartIssue> } {
  const issues: Record<string, CartIssue> = {};
  const next = lines.map((line) => {
    const current = live.get(line.variantId);

    let reason: string | null = null;
    if (gone.has(line.slug)) reason = "This product is no longer available";
    else if (!current) reason = "This option is no longer available";
    else if (current.stock < 1) reason = "Out of stock";

    if (reason !== null) {
      issues[line.variantId] = { reason };
      return line;
    }

    return {
      ...line,
      unitPriceCents: current!.priceCents,
      // Refreshed even when stock went up, so the stepper offers the new headroom without a reload.
      maxQuantity: current!.stock,
      quantity: Math.min(line.quantity, current!.stock),
    };
  });

  return { lines: next, issues };
}