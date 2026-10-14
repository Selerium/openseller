import { z } from "zod";

/**
 * Shared address shape.
 *
 * Mirrors the limits in backend/src/lib/address.ts. Duplicated rather than
 * imported because frontend and backend are separate deployables with no shared
 * package. Matching them here refuses an over-long value in the form instead of
 * costing a round trip to be refused with the same message.
 */
export const addressSchema = z.object({
  label: z.string().max(40, "Label must be at most 40 characters"),
  recipientName: z.string().min(1, "Recipient name is required").max(120),
  line1: z.string().min(1, "Address line 1 is required").max(200),
  line2: z.string().max(200),
  city: z.string().min(1, "City is required").max(100),
  region: z.string().max(100),
  postalCode: z.string().max(24),
  countryCode: z
    .string()
    .min(1, "Country is required")
    .length(2, "Country must be a 2-letter ISO code"),
  phone: z.string().max(32),
});

export type AddressFormData = z.infer<typeof addressSchema>;

export const emptyAddress: AddressFormData = {
  label: "Home",
  recipientName: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "",
  phone: "",
};

/** The `data` half of GET /addresses and POST /addresses responses. */
export interface SavedAddress {
  id: string;
  label: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function toFormData(address: SavedAddress): AddressFormData {
  return {
    label: address.label ?? "Home",
    recipientName: address.recipientName ?? "",
    line1: address.line1 ?? "",
    line2: address.line2 ?? "",
    city: address.city ?? "",
    region: address.region ?? "",
    postalCode: address.postalCode ?? "",
    countryCode: address.countryCode ?? "",
    phone: address.phone ?? "",
  };
}

/**
 * One-line summary with several identifying details, so a dropdown of three
 * "Home" addresses is still telling them apart: label, name, street, city,
 * country, and phone when present.
 */
export function formatAddressOption(address: SavedAddress): string {
  const parts: string[] = [];
  if (address.label) parts.push(address.label);
  if (address.recipientName) parts.push(address.recipientName);
  if (address.line1) parts.push(address.line1);
  if (address.city) parts.push(address.city);
  if (address.countryCode) parts.push(address.countryCode);
  let text = parts.join(" — ");
  const extras: string[] = [];
  if (address.postalCode) extras.push(address.postalCode);
  if (address.phone) extras.push(address.phone);
  if (extras.length > 0) text += ` (${extras.join(", ")})`;
  if (address.isDefault) text += " • Default";
  return text;
}

/** Multi-line display for cards and order summaries. */
export function formatAddressLines(address: {
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string;
}): string[] {
  const line2 = address.line2?.trim() ? `, ${address.line2!.trim()}` : "";
  const region = address.region?.trim() ? `, ${address.region!.trim()}` : "";
  const postal = address.postalCode?.trim() ? ` ${address.postalCode!.trim()}` : "";
  return [
    `${address.line1}${line2}`,
    `${address.city}${region}${postal}`,
    address.countryCode ?? "",
  ].filter(Boolean);
}

/** Empty string -> null, so optional fields round-trip as null, not "". */
export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}
