import AppError from "./appError.ts";

/**
 * A validated, normalised postal address.
 *
 * This is the shape stored in Order.shippingAddress / billingAddress, and also the shape written
 * to Address rows. One type for both, because they must agree: an order's snapshot is supposed
 * to be exactly what would have been saved in the address book, and the two drifting apart is
 * how a checkout ends up accepting a "city" of 4000 characters.
 */
export interface AddressSnapshot {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
}

/**
 * Length limits are enforced here rather than by a database constraint because these values
 * land in a Json column, and a Json column has no column-level length limit at all. Without
 * these, `line1` would happily accept a novel.
 */
const LIMITS = {
  recipientName: 120,
  line1: 200,
  line2: 200,
  city: 100,
  region: 100,
  postalCode: 24,
  countryCode: 2,
  phone: 32,
  label: 40,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trim, collapse internal runs of whitespace, and enforce a length ceiling. */
function requiredString(
  value: unknown,
  field: string,
  max: number,
): string {
  if (typeof value !== "string") {
    throw new AppError(`${field} is required`, 400);
  }
  // Collapse runs of whitespace so "Dubai  ,   UAE" and "Dubai, UAE" store identically, and so
  // a value made entirely of whitespace fails the emptiness check below.
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    throw new AppError(`${field} is required`, 400);
  }
  if (cleaned.length > max) {
    throw new AppError(`${field} must be at most ${max} characters`, 400);
  }
  return cleaned;
}

function optionalString(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(`${field} must be a string`, 400);
  }
  const cleaned = value.trim().replace(/\s+/g, " ");
  // An all-whitespace optional field is treated as absent rather than as an empty string, so it
  // round-trips as null instead of showing up in the UI as a blank line.
  if (!cleaned) return null;
  if (cleaned.length > max) {
    throw new AppError(`${field} must be at most ${max} characters`, 400);
  }
  return cleaned;
}

/**
 * Validate a client-supplied address.
 *
 * `countryCode` is upper-cased rather than merely checked: the country selector already sends
 * upper case, but the value is also used to group addresses, and "ae" and "AE" would then sort
 * and filter as two different countries.
 */
export function parseAddressInput(value: unknown): AddressSnapshot {
  if (!isRecord(value)) {
    throw new AppError("A shipping address is required", 400);
  }

  const countryCode = requiredString(
    value.countryCode,
    "Country",
    LIMITS.countryCode,
  ).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new AppError("Country must be a 2-letter ISO code", 400);
  }

  return {
    recipientName: requiredString(value.recipientName, "Recipient name", LIMITS.recipientName),
    line1: requiredString(value.line1, "Address line 1", LIMITS.line1),
    line2: optionalString(value.line2, "Address line 2", LIMITS.line2),
    city: requiredString(value.city, "City", LIMITS.city),
    region: optionalString(value.region, "Region", LIMITS.region),
    postalCode: optionalString(value.postalCode, "Postal code", LIMITS.postalCode),
    countryCode,
    phone: optionalString(value.phone, "Phone", LIMITS.phone),
  };
}

/** Same rules, for the optional `label` on an Address row. */
export function parseAddressLabel(value: unknown): string {
  return optionalString(value, "Label", LIMITS.label) ?? "Home";
}