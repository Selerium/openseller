/**
 * Money formatting for the storefront.
 *
 * Prices render as `18.50 USD`, never as a symbol. Which glyph a currency code maps to is
 * locale-dependent, and locale is a property of the reader's browser, not the store, so
 * symbol output would produce different strings for different readers of the same page.
 * The code is unambiguous and stable.
 *
 * The backend sends integer minor units plus a currency code (see lib/http.ts formatMoney).
 * Keep the divisor logic in sync with the backend's minorUnitDivisor: JPY has no minor unit,
 * most currencies use 100, and BHD/KWD/OMR use 1000.
 */

export function minorUnitDivisor(currency: string): number {
  const code = currency.toLowerCase();
  if (
    [
      "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw",
      "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
    ].includes(code)
  ) {
    return 1;
  }
  if (["bhd", "iqd", "jod", "kwd", "lyd", "omr", "tnd"].includes(code)) return 1000;
  return 100;
}

export function formatMoney(
  minorUnits: number,
  currency = process.env.NEXT_PUBLIC_STORE_CURRENCY || "usd"
): string {
  const divisor = minorUnitDivisor(currency);
  const places = divisor === 1 ? 0 : divisor === 1000 ? 3 : 2;
  const negative = minorUnits < 0;
  const amount = (Math.abs(minorUnits) / divisor).toFixed(places);

  return `${negative ? "-" : ""}${amount} ${currency.toUpperCase()}`;
}