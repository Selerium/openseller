/**
 * How both sides of the editor read an element's `fields`.
 *
 * The stored document is `Record<string, unknown>` — it went through the backend's generic
 * bounds check (`parseFields` in backend/src/lib/homepage.ts), not a per-kind schema — so
 * every read has to decide what a missing, empty or wrong-shaped value means. That decision
 * belongs in one place: a form that defaults a missing limit to 8 and a renderer that
 * defaulted it to 1 would show the admin one element and ship visitors another.
 *
 * These readers are total: they never throw and never return `undefined`, so a document
 * written by an older editor renders as its blanks rather than taking down the storefront.
 */

/** A field as text. Missing, empty and non-string values all read as "". */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A field as a whole number clamped into `[min, max]`.
 *
 * Accepts a number or a numeric string, since the number input hands back whichever the
 * document holds. Anything unparseable — absent on an element created before the field
 * existed — reads as `fallback`, which is the same default the form inserts.
 */
export function count(value: unknown, fallback: number, min: number, max: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * A link the storefront is willing to render, or null.
 *
 * `fields` are authored by an admin, but they are still an unchecked document served to
 * visitors, and an `<a href="javascript:…">` inside a button preset is one fat-fingered
 * paste away from code running in a shopper's session. Only absolute http(s) URLs and
 * site-relative targets (`/marketplace`, `#section`) pass — which covers every default the
 * registry ships.
 */
export function safeHref(value: unknown): string | null {
  const href = text(value).trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  return null;
}

/**
 * A stored string list, with non-string entries dropped.
 *
 * Empty strings are kept: the image form shows them as unfilled rows the admin can still
 * remove. The renderer is what filters them out.
 */
export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** One button of the `button` preset. */
export interface ButtonEntry {
  label: string;
  href: string;
}

/** The `buttons` field of the button preset, with entries of the wrong shape read as blank. */
export function readButtons(value: unknown): ButtonEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record =
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    return { label: text(record.label), href: text(record.href) };
  });
}

/** Input types the contact form can render. Anything stored outside this list reads as "text". */
export const INPUT_TYPES = ["text", "email", "tel", "number", "textarea"] as const;

export type ContactInputType = (typeof INPUT_TYPES)[number];

/** One field of the contact form preset, as data rather than hard-coded markup. */
export interface ContactInputEntry {
  key: string;
  label: string;
  type: ContactInputType;
  required: boolean;
}

/** The `inputs` field of the contact form preset, with unknown types coerced to "text". */
export function readContactInputs(value: unknown): ContactInputEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record =
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    const type = text(record.type);
    return {
      key: text(record.key),
      label: text(record.label),
      type: (INPUT_TYPES as readonly string[]).includes(type)
        ? (type as ContactInputType)
        : "text",
      required: record.required === true,
    };
  });
}

/**
 * Sort orders the product grid understands, as the select's options and the API's `sort`
 * values in one list — the form writes the value the catalog endpoint reads, so the two can
 * never drift apart. Anything else in a document (a value from an older editor, a typo)
 * reads as "newest", which is also the endpoint's own fallback.
 */
export const PRODUCT_SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "rating", label: "Best rated" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
] as const;

/** The product grid's stored order, normalised to one the API accepts. */
export function productSort(value: unknown): string {
  const sort = text(value);
  return PRODUCT_SORTS.some((option) => option.value === sort) ? sort : "newest";
}
