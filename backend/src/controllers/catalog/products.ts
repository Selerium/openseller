import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import AppError from "../../lib/appError.ts";
import { ok, pageOf, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";
import { effectivePrice, toProductCard } from "../../lib/catalog.ts";
import { config } from "../../lib/config.ts";

const productsRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Card-shaped columns shared by list and detail responses. */
const cardInclude = {
  images: { orderBy: { position: "asc" as const }, take: 1 },
  category: { select: { id: true, name: true, slug: true } },
};

/**
 * Public: marketplace grid.
 *
 * Reads the denormalised Product.minPriceCents / stockTotal instead of aggregating variants,
 * so a page of 24 cards is two queries regardless of how many variants each product has.
 */
productsRouter.get("", async (req, res) => {
  const { page, perPage, skip, take } = parsePage(req.query);

  const search = String(req.query.search ?? "").trim();
  const categorySlug = String(req.query.category ?? "").trim();
  const sort = String(req.query.sort ?? "newest");
  const inStockOnly = String(req.query.inStock ?? "") === "true";
  const discountedOnly = String(req.query.discounted ?? "") === "true";

  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    deletedAt: null,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(inStockOnly ? { stockTotal: { gt: 0 } } : {}),
    ...(discountedOnly ? { discountPercent: { gt: 0 } } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { brief: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // Sorts: newest (default) | price_asc | price_desc | rating | title_asc. Anything else
  // falls through to newest.
  //
  // Price sorts read salePriceCents, the post-discount rollup, not minPriceCents. Sorting on the
  // pre-discount price would put a half-off 100.00 above an undiscounted 60.00, so "sort by
  // price" would not match the price printed on the card.
  //
  // Every sort ends on the id tiebreaker: without it, rows with equal sort keys can shuffle
  // between requests and a page boundary can repeat or skip a product.
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ salePriceCents: "asc" }, STABLE_ID_ORDER]
      : sort === "price_desc"
        ? [{ salePriceCents: "desc" }, STABLE_ID_ORDER]
        : sort === "rating"
          ? [{ ratingCount: "desc" }, { ratingAvg: "desc" }, STABLE_ID_ORDER]
          : sort === "title_asc"
            ? [{ title: "asc" }, STABLE_ID_ORDER]
            : [{ createdAt: "desc" }, STABLE_ID_ORDER];

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        ...cardInclude,
        // take 2 is enough to know whether this is a multi-variant product
        variants: { select: { id: true }, take: 2 },
      },
    }),
  ]);

  ok(res, pageOf(products.map(toProductCard), total, page, perPage));
});

/**
 * Public: single product by slug (or raw id, which is handy for the admin preview).
 * Draft and archived products are treated as not found here; the admin API serves those.
 */
productsRouter.get("/:slug", async (req, res) => {
  const key = req.params.slug;
  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    deletedAt: null,
    ...(UUID.test(key) ? { OR: [{ id: key }, { slug: key }] } : { slug: key }),
  };

  const product = await prisma.product.findFirst({
    where,
    include: {
      images: { orderBy: { position: "asc" } },
      variants: { orderBy: [{ position: "asc" }, { priceCents: "asc" }] },
      category: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!product) throw new AppError("Product not found", 404);

  ok(res, {
    id: product.id,
    slug: product.slug,
    title: product.title,
    brief: product.brief,
    description: product.description,
    category: product.category,
    currency: config.currency,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
    })),
    // sku is intentionally withheld: the cart binds to variantId, so publishing it
    // would only give the storefront something to misuse.
    // Each variant is discounted individually. Only the product minimum is stored
    // (salePriceCents); the per-variant figures are derived, so they go through the same
    // helper the rollup used or the picker and the summary line would disagree.
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      priceCents: effectivePrice(variant.priceCents, product.discountPercent),
      listPriceCents:
        product.discountPercent > 0 ? variant.priceCents : null,
      inStock: variant.stock > 0,
      quantity: variant.stock,
    })),
    // product level rollups, so the card and the detail header agree
    priceCents: product.salePriceCents,
    listPriceCents: product.discountPercent > 0 ? product.minPriceCents : null,
    discountPercent: product.discountPercent,
    priceFrom: product.variants.length > 1,
    inStock: product.stockTotal > 0,
    quantity: product.stockTotal,
    ratingAvg: Math.round(product.ratingAvg * 10) / 10,
    ratingCount: product.ratingCount,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  });
});

export default productsRouter;
