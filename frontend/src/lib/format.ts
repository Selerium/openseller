/**
 * Count formatting for the storefront.
 *
 * Rating counts are abbreviated on regular SI unit divisions — 1000 becomes "1k", 1_500_000
 * becomes "1.5M" — so a card's rating row stays a fixed width no matter how many reviews a
 * product has. Only the count is abbreviated; the average rating is always shown at full
 * precision, because "4.5 stars" is information and "4.5k stars" is not.
 *
 * SI rather than the short scale: 1_000_000 is a mega (M) either way, but the short scale would
 * make 1_000 a "thousand" (K) while the long scale would make 1_000_000_000 a "milliard". SI
 * steps by 1000 at every unit, which is what people expect when they see "1k / 1M / 1B".
 */

const SI_UNITS = [
  { limit: 1e12, suffix: "T" },
  { limit: 1e9, suffix: "B" },
  { limit: 1e6, suffix: "M" },
  { limit: 1e3, suffix: "k" },
] as const;

/**
 * Trims a trailing ".0" so 1.0k renders as "1k" and 1.5k keeps its half.
 *
 * toFixed then parseFloat, rather than a regex on the string: parseFloat normalises the value
 * so the caller cannot accidentally produce "1.00k".
 */
function trim(value: number): string {
  return String(parseFloat(value.toFixed(1)));
}

/**
 * Abbreviates a count to at most 4 characters ("999", "1k", "1.5M").
 *
 * Counts below 1000 are returned untouched — the exact number is always short enough to show,
 * and rounding "847" to "847" is a no-op while rounding to "0.8k" would be a lie about a
 * product that has not 1000 reviews.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value < 1000) return String(Math.floor(value));

  for (const { limit, suffix } of SI_UNITS) {
    if (value >= limit) return `${trim(value / limit)}${suffix}`;
  }

  return String(Math.floor(value));
}

/**
 * "1 review" / "12 reviews" / "1.2k reviews".
 *
 * Kept separate from formatCount so the plural is decided by the real count rather than by the
 * abbreviated string — "1k reviews" is correct, but "1.0k review" would not be, and truncating
 * before pluralising is the kind of thing that ships.
 */
export function formatReviews(value: number): string {
  return `${formatCount(value)} ${value === 1 ? "review" : "reviews"}`;
}