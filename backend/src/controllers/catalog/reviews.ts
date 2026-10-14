import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import AppError from "../../lib/appError.ts";
import { ok, pageOf, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";

const reviewsRouter = express.Router();

/**
 * Public: paginated reviews for a product, newest first.
 * Accepts either a product id or a slug so the detail page can reuse its own route key.
 * Only PUBLISHED reviews are ever visible here; hiding one in the admin removes it.
 */
reviewsRouter.get("/:productKey/reviews", async (req, res) => {
  const { page, perPage, skip, take } = parsePage(req.query);
  const key = req.params.productKey;

  const product = await prisma.product.findFirst({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      ...(key.length === 36 ? { OR: [{ id: key }, { slug: key }] } : { slug: key }),
    },
    select: { id: true },
  });

  if (!product) throw new AppError("Product not found", 404);

  const where: Prisma.ReviewWhereInput = {
    productId: product.id,
    status: "PUBLISHED",
  };

  const [total, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, STABLE_ID_ORDER],
      skip,
      take,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        createdAt: true,
        profile: { select: { name: true } },
      },
    }),
  ]);

  const items = reviews.map((review) => {
    const name = review.profile?.name ?? "Anonymous";
    return {
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      createdAt: review.createdAt,
      authorName: name,
      // enough for an initials avatar without shipping a second endpoint
      authorInitials: name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join(""),
    };
  });

  ok(res, pageOf(items, total, page, perPage));
});

export default reviewsRouter;
