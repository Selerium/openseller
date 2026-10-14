import type { Product, ProductImage, Category } from "../generated/prisma/client.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { prisma } from "./prismaClient.ts";
import { config } from "./config.ts";

/** Either the root client or an interactive-transaction client, so helpers compose. */
export type Db = typeof prisma | Prisma.TransactionClient;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    // strip combining accents so "Crème" and "Creme" slug the same
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Slugify a title and step aside until it is unique. */
export async function uniqueProductSlug(
  title: string,
  ignoreProductId?: string,
  db: Db = prisma,
): Promise<string> {
  const base = slugify(title) || "product";

  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    const existing = await db.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === ignoreProductId) return candidate;
  }

  return `${base}-${Date.now()}`;
}

/**
 * Recomputes the denormalised card fields from a product's variants.
 *
 * Marketplace cards read Product.minPriceCents / Product.stockTotal rather than aggregating
 * every variant per request, so every variant write must call this inside the same
 * transaction that changed the variant.
 */
export async function recomputeProductRollup(
  productId: string,
  db: Db = prisma,
): Promise<void> {
  // discountPercent is read here rather than passed in, because it lives on Product and a
  // discount edit must refresh the same rollups a price edit does. Callers that only change
  // discountPercent still have to invoke this.
  const [cheapest, stock, product] = await Promise.all([
    db.variant.findFirst({
      where: { productId },
      orderBy: { priceCents: "asc" },
      select: { priceCents: true },
    }),
    db.variant.aggregate({ where: { productId }, _sum: { stock: true } }),
    db.product.findUnique({
      where: { id: productId },
      select: { discountPercent: true },
    }),
  ]);

  const minPriceCents = cheapest?.priceCents ?? 0;

  await db.product.update({
    where: { id: productId },
    data: {
      minPriceCents,
      stockTotal: stock._sum.stock ?? 0,
      salePriceCents: effectivePrice(minPriceCents, product?.discountPercent ?? 0),
    },
  });
}

/**
 * Recomputes Product.ratingAvg / ratingCount over published reviews.
 * Hidden reviews drop out of the aggregate, so moderating a review also fixes the score.
 */
export async function recomputeProductRating(
  productId: string,
  db: Db = prisma,
): Promise<void> {
  const aggregate = await db.review.aggregate({
    where: { productId, status: "PUBLISHED" },
    _avg: { rating: true },
    _count: { _all: true },
  });

  await db.product.update({
    where: { id: productId },
    data: {
      ratingAvg: aggregate._avg.rating ?? 0,
      ratingCount: aggregate._count._all ?? 0,
    },
  });
}

export type CategorySummary = Pick<Category, "id" | "name" | "slug">;

type CardProduct = Product & {
  images: ProductImage[];
  variants: { id: string }[];
  category: CategorySummary | null;
};

/**
 * The price actually charged after a product-wide markdown, in minor units.
 *
 * Product.discountPercent is a percentage rather than a stored "was" price, so the effective
 * price is derived. It is rounded half-up to a whole minor unit so the result is always valid
 * money.
 *
 * Rounding is half-up and NOT floor: flooring 18.50 USD by 15% gives 15.72 instead of 15.73,
 * which silently loses a cent per discount and makes the advertised price disagree with the
 * charge. Because the card, the detail page and later checkout must all agree to the cent,
 * every surface goes through this function rather than repeating the arithmetic.
 *
 * The percent is clamped rather than trusted: the admin API is the only writer, but 0-100 is an
 * invariant a CHECK constraint should own, and this must not return a negative price if that
 * constraint is ever missing.
 */
export function effectivePrice(baseCents: number, discountPercent: number): number {
  const percent = Math.min(100, Math.max(0, Math.trunc(discountPercent || 0)));
  if (percent === 0) return baseCents;
  if (percent >= 100) return 0;
  return Math.round((baseCents * (100 - percent)) / 100);
}

const roundRating = (value: number) => Math.round(value * 10) / 10;

/**
 * Card shape for the marketplace grid: image, title, brief, price, inStock, quantity.
 * `priceFrom` tells the UI to render "from" when the product has more than one variant.
 *
 * Price comes in three parts so no surface has to recompute anything:
 *   priceCents      the effective price, after the markdown. What to charge and to show large.
 *   listPriceCents  the pre-discount price, for the struck-through original. null when the
 *                   product is not discounted, which is what distinguishes "no discount" from
 *                   "discounted to zero".
 *   discountPercent echoed so the UI can render a "-15%" badge without arithmetic.
 */
export function toProductCard(product: CardProduct) {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    brief: product.brief,
    image: product.images[0]?.url ?? null,
    category: product.category,
    priceCents: product.salePriceCents,
    listPriceCents: product.discountPercent > 0 ? product.minPriceCents : null,
    discountPercent: product.discountPercent,
    priceFrom: product.variants.length > 1,
    currency: config.currency,
    inStock: product.stockTotal > 0,
    quantity: product.stockTotal,
    ratingAvg: roundRating(product.ratingAvg),
    ratingCount: product.ratingCount,
    createdAt: product.createdAt,
  };
}
