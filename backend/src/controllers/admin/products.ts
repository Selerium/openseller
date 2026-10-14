import express from "express";
import { prisma, ProductStatus } from "../../lib/prismaClient.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import AppError from "../../lib/appError.ts";
import { created, ok, pageOf, parseEnum, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";
import { recomputeProductRollup } from "../../lib/catalog.ts";

const productsRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cardInclude = {
  images: { orderBy: { position: "asc" as const }, take: 1 },
  category: { select: { id: true, name: true, slug: true } },
};

/**
 * One include for every detail response, so the editor, the stock table and the raw GET can
 * never drift into reading different rows. `loadDetail` below is the only place it is applied.
 */
const detailInclude = {
  images: { orderBy: { position: "asc" as const } },
  variants: { orderBy: [{ position: "asc" as const }, { priceCents: "asc" as const }] },
  category: { select: { id: true, name: true, slug: true } },
};

function loadDetail(where: Prisma.ProductWhereInput) {
  return prisma.product.findFirst({ where, include: detailInclude });
}

type DetailProduct = NonNullable<Awaited<ReturnType<typeof loadDetail>>>;

/**
 * The path parameter is an id or a slug: the editor links by id (a slug is editable, so a
 * slug in the URL goes stale the moment it is changed), but a shared link is far more likely
 * to be the human-readable one, and the marketplace already addresses products that way.
 */
function findWhere(id: string): Prisma.ProductWhereInput {
  return UUID.test(id) ? { id } : { slug: id };
}

async function loadDetailOr404(where: Prisma.ProductWhereInput): Promise<DetailProduct> {
  const product = await loadDetail(where);
  if (!product) throw new AppError("Product not found", 404);
  return product;
}

/**
 * The detail body, in the shape every GET, PUT, PATCH and stock write answers with.
 *
 * Deliberately not the raw row: the row carries denormalised rollups and relations the editor
 * has no use for, and returning it whole meant each endpoint had to remember which of them to
 * strip. One mapper, one shape, and a client that reads `data` from any of them behaves the
 * same.
 */
function toProductDetail(product: DetailProduct) {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    brief: product.brief,
    description: product.description,
    status: product.status,
    category: product.category,
    currency: "USD",
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      position: image.position,
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      priceCents: variant.priceCents,
      stock: variant.stock,
      position: variant.position,
    })),
    priceCents: product.salePriceCents,
    minPriceCents: product.minPriceCents,
    discountPercent: product.discountPercent,
    stockTotal: product.stockTotal,
    ratingAvg: Math.round(product.ratingAvg * 10) / 10,
    ratingCount: product.ratingCount,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/** GET /admin/products - list all products (any status) with pagination */
productsRouter.get("", async (req, res) => {
  const { page, perPage, skip, take } = parsePage(req.query);
  const search = String(req.query.search ?? "").trim();
  const status = parseEnum(req.query.status, ProductStatus, "status");

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ createdAt: "desc" }, STABLE_ID_ORDER];

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        ...cardInclude,
        variants: { select: { id: true, priceCents: true, stock: true } },
      },
    }),
  ]);

  ok(res, pageOf(products.map((p: any) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    currency: "USD",
    minPriceCents: p.minPriceCents,
    salePriceCents: p.salePriceCents,
    discountPercent: p.discountPercent,
    stockTotal: p.stockTotal,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    category: p.category,
    image: p.images[0]?.url ?? null,
    variantCount: p.variants.length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  })), total, page, perPage));
});

/** GET /admin/products/:id */
productsRouter.get("/:id", async (req, res) => {
  ok(res, toProductDetail(await loadDetailOr404(findWhere(req.params.id))));
});

/** POST /admin/products */
productsRouter.post("", async (req, res) => {
  const { title, slug, brief, description, categoryId, status, discountPercent = 0 } = req.body ?? {};
  if (!title || !slug) throw new AppError("Title and slug required", 400);

  const product = await prisma.product.create({
    data: {
      title,
      slug,
      brief: brief ?? null,
      description: description ?? null,
      categoryId: categoryId ?? null,
      status: parseEnum(status, ProductStatus, "status") ?? "DRAFT",
      discountPercent: Number(discountPercent) || 0,
      minPriceCents: 0,
      salePriceCents: 0,
      stockTotal: 0,
    },
    include: detailInclude,
  });

  created(res, toProductDetail(product));
});

/**
 * PUT/PATCH /admin/products/:id — partial update of the fields an admin edits by hand.
 *
 * Present means "set", absent means "leave alone", which is why every field is tested against
 * `undefined` rather than defaulted with `??`. The previous version used `categoryId ?? product
 * .categoryId`, which made it *impossible* to clear the category: null fell through to the old
 * value. `null` and `""` now both mean "no category", matching the nullable column.
 *
 * The write and the rollup it can invalidate (a discount change moves salePriceCents) land in
 * one transaction. They are read as a pair on every marketplace card, so a discount that
 * committed without its new effective price would advertise the old price until the next
 * unrelated write.
 */
async function updateProduct(req: express.Request, res: express.Response) {
  const product = await prisma.product.findFirst({ where: findWhere(req.params.id) });
  if (!product) throw new AppError("Product not found", 404);

  const { title, slug, brief, description, categoryId, status, discountPercent } = req.body ?? {};

  const data: Prisma.ProductUpdateInput = {};

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) throw new AppError("Title cannot be empty", 400);
    data.title = title.trim();
  }

  if (slug !== undefined) {
    if (typeof slug !== "string" || !slug.trim()) throw new AppError("Slug cannot be empty", 400);
    const next = slug.trim();
    // Marketplace URLs are /marketplace/:slug, so a slug with spaces or capitals in it is a
    // link that does not work. Refused here rather than silently slugified: an admin who typed
    // something specific should be told what the rule is, not get something else.
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(next)) {
      throw new AppError("Slug must be lowercase letters, numbers and single dashes", 400, { field: "slug" });
    }
    if (next !== product.slug) {
      const taken = await prisma.product.findUnique({ where: { slug: next }, select: { id: true } });
      if (taken) throw new AppError("That slug is already in use", 409, { field: "slug" });
    }
    data.slug = next;
  }

  if (brief !== undefined) {
    if (typeof brief !== "string") throw new AppError("brief must be text", 400);
    data.brief = brief;
  }

  if (description !== undefined) {
    if (typeof description !== "string") throw new AppError("description must be text", 400);
    data.description = description;
  }

  if (categoryId !== undefined) {
    // "" and null both mean "no category", because the form sends "" for its blank option and
    // the column is nullable.
    const next = categoryId === null || categoryId === "" ? null : String(categoryId);
    if (next) {
      const category = await prisma.category.findUnique({ where: { id: next }, select: { id: true } });
      if (!category) throw new AppError("Category not found", 404, { field: "categoryId" });
    }
    data.categoryId = next;
  }

  if (status !== undefined) {
    data.status = parseEnum(status, ProductStatus, "status") ?? product.status;
  }

  if (discountPercent !== undefined) {
    const percent = Number(discountPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new AppError("discountPercent must be between 0 and 100", 400, { field: "discountPercent" });
    }
    data.discountPercent = Math.trunc(percent);
  }

  const rollupMayHaveMoved = discountPercent !== undefined && Math.trunc(Number(discountPercent)) !== product.discountPercent;

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: product.id }, data });
    if (rollupMayHaveMoved) await recomputeProductRollup(product.id, tx);
  });

  ok(res, toProductDetail(await loadDetailOr404({ id: product.id })), "Product updated");
}

productsRouter.put("/:id", updateProduct);
productsRouter.patch("/:id", updateProduct);

/**
 * PATCH /admin/products/:id/variants — set stock (and price) on this product's variants.
 *
 * Batch rather than one row at a time because that is how the editor uses it: an admin counts
 * a shelf, types several numbers, and presses Save once. Every row is checked against the
 * product in the URL before anything is written, so an id from another product cannot be
 * reached through this route, and the whole thing is one transaction — a half-saved stock
 * table is worse than a refused one.
 *
 * Price rides along for the same reason it is in the same row of the same table: both are
 * per-variant numbers, both move the marketplace card, and both are re-read through the rollup
 * recomputed below (minPriceCents and stockTotal are maintained, never derived at read time).
 */
productsRouter.patch("/:id/variants", async (req, res) => {
  const product = await prisma.product.findFirst({ where: findWhere(req.params.id) });
  if (!product) throw new AppError("Product not found", 404);

  const rows = req.body?.variants;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError("variants must be a non-empty array", 400);
  }

  const updates = rows.map((row: any) => {
    const id = String(row?.id ?? "");
    if (!UUID.test(id)) throw new AppError("Each variant needs an id", 400);

    const stock = row?.stock === undefined ? undefined : toCount(row.stock, "stock");
    const priceCents = row?.priceCents === undefined ? undefined : toCount(row.priceCents, "priceCents");
    if (stock === undefined && priceCents === undefined) {
      throw new AppError("Variant has neither stock nor price to update", 400);
    }

    return { id, data: { ...(stock !== undefined ? { stock } : {}), ...(priceCents !== undefined ? { priceCents } : {}) } };
  });

  await prisma.$transaction(async (tx) => {
    for (const { id, data } of updates) {
      // updateMany with the productId in the where rather than update by id: it answers
      // "not on this product" as count 0 instead of writing the row anyway.
      const { count } = await tx.variant.updateMany({ where: { id, productId: product.id }, data });
      if (count === 0) throw new AppError("Variant not found on this product", 404, { variantId: id });
    }
    await recomputeProductRollup(product.id, tx);
  });

  const fresh = await loadDetailOr404({ id: product.id });
  ok(res, toProductDetail(fresh), `${updates.length} variant${updates.length === 1 ? "" : "s"} updated`);
});

/** POST /admin/products/:id/enable | /disable */
productsRouter.post("/:id/enable", async (req, res) => {
  const product = await prisma.product.findFirst({ where: findWhere(req.params.id) });
  if (!product) throw new AppError("Product not found", 404);
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { status: "ACTIVE" },
  });
  ok(res, { id: updated.id, status: updated.status });
});

productsRouter.post("/:id/disable", async (req, res) => {
  const product = await prisma.product.findFirst({ where: findWhere(req.params.id) });
  if (!product) throw new AppError("Product not found", 404);
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { status: "ARCHIVED" },
  });
  ok(res, { id: updated.id, status: updated.status });
});

/**
 * A whole number that cannot go negative. Stock and price are counts and money in minor units;
 * "1.5 in stock" and "-4 USD" are client bugs, and Prisma would reject both as a 500 rather
 * than as the bad request they are.
 */
function toCount(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(`${name} must be a whole number of 0 or more`, 400, { field: name });
  }
  return parsed;
}

export default productsRouter;
