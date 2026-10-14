import type { Response } from "express";
import AppError from "./appError.ts";
import { config, minorUnitDivisor } from "./config.ts";

/**
 * Every list endpoint in the API takes `?page` (1-based) and `?perPage`, and returns a page
 * envelope under `data`. Keeping this in one place is what lets a single `<Pagination>`
 * component drive every list screen.
 */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export const DEFAULT_PER_PAGE = 24;
export const MAX_PER_PAGE = 100;

export function parsePage(query: Record<string, unknown>): {
  page: number;
  perPage: number;
  skip: number;
  take: number;
} {
  const rawPage = Number.parseInt(String(query.page ?? "1"), 10);
  const rawPerPage = Number.parseInt(String(query.perPage ?? DEFAULT_PER_PAGE), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const perPage =
    Number.isFinite(rawPerPage) && rawPerPage > 0
      ? Math.min(rawPerPage, MAX_PER_PAGE)
      : DEFAULT_PER_PAGE;

  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

/**
 * Validate an enum-shaped request value before it can reach Prisma.
 *
 * Prisma rejects an unknown enum member with a validation error, which the error handler
 * reports as a 500 — the server taking the blame for the client's typo. A malformed filter
 * or body field is a bad request: this says which value was wrong and what it accepts, with
 * the allowed members also attached as `data.allowed` so a client can build a dropdown
 * instead of parsing English.
 *
 * Absent, null and empty all mean "not provided": list endpoints read that as "no filter"
 * and write endpoints as "leave unchanged", which is how both already treated values that
 * never reached Prisma. (Callers that want null to *clear* a nullable field check for it
 * before calling.)
 *
 * `allowed` takes the generated enum object (re-exported by lib/prismaClient.ts), so the
 * accepted values are whatever the schema says and cannot drift from it.
 */
export function parseEnum<T extends string>(
  value: unknown,
  allowed: Readonly<Record<string, T>>,
  name: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;

  const raw = String(value).trim();
  if (!raw) return undefined;

  const values = Object.values(allowed);
  if (values.includes(raw as T)) return raw as T;

  throw new AppError(
    `Invalid ${name}: expected one of ${values.join(", ")}`,
    400,
    { allowed: values },
  );
}

export function pageOf<T>(
  items: T[],
  total: number,
  page: number,
  perPage: number,
): Page<T> {
  return {
    items,
    total,
    page,
    perPage,
    // an empty result is still "page 1 of 1" so the UI never renders "page 1 of 0"
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** First id sort key appended to every list query so paging cannot repeat or skip rows. */
export const STABLE_ID_ORDER = { id: "asc" } as const;

/**
 * Money is carried over the wire as integer minor units plus a currency code, and rendered
 * as `18.50 USD`.
 *
 * Symbols are deliberately not used. Which glyph a currency maps to is locale-dependent, and
 * locale is a property of the reader's browser, not of the store. Rendering the code keeps
 * every price unambiguous and stable across server HTML, client hydration and copy-paste.
 *
 * Formatting lives on the server so hydration cannot disagree with the server-rendered
 * markup: if both sides called `toLocaleString`, a browser locale mismatch would produce
 * different strings and React would discard the tree.
 */
export function formatMoney(minorUnits: number, currency = config.currency): string {
  const divisor = minorUnitDivisor(currency);
  const negative = minorUnits < 0;
  // toFixed(2) on a float is exact enough for money at these magnitudes and, unlike a
  // hand-rolled split, cannot drop or duplicate a digit
  const amount = (Math.abs(minorUnits) / divisor).toFixed(decimalPlaces(divisor));

  return `${negative ? "-" : ""}${amount} ${currency.toUpperCase()}`;
}

function decimalPlaces(divisor: number): number {
  return divisor === 1 ? 0 : divisor === 1000 ? 3 : 2;
}

export function ok<T>(res: Response, data: T, message = ""): void {
  res.status(200).json({ data, message, error: false });
}

export function created<T>(res: Response, data: T, message = ""): void {
  res.status(201).json({ data, message, error: false });
}

export function noContent(res: Response): void {
  res.status(204).end();
}
