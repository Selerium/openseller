import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { ok, pageOf, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";
import AppError from "../../lib/appError.ts";
import checkTokens from "../../middleware/checkTokens.ts";

const reviewsRouter = express.Router();

reviewsRouter.get("/:productId", async (req, res) => {
  const productId = req.params.productId;
  const { page, perPage, skip, take } = parsePage(req.query);
  const where: Prisma.ReviewWhereInput = { productId, deletedAt: null };
  const [total, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, STABLE_ID_ORDER],
      skip,
      take,
      include: { profile: { select: { name: true } } },
    }),
  ]);
  ok(res, pageOf(reviews.map((r: any) => ({
    id: r.id,
    productId: r.productId,
    profileId: r.profileId,
    name: r.profile?.name ?? null,
    rating: r.rating,
    body: r.body,
    createdAt: r.createdAt,
  })), total, page, perPage));
});

reviewsRouter.post("/:productId", checkTokens, async (req, res) => {
  const productId = req.params.productId;
  const { rating, body } = req.body ?? {};
  if (!rating || Number(rating) < 1 || Number(rating) > 5) throw new AppError("Rating must be 1-5", 400);
  const profileId = req.user!.profileId;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError("Product not found", 404);
  const review = await prisma.review.create({
    data: {
      productId,
      profileId,
      rating: Number(rating),
      body: body ?? null,
    },
  });
  ok(res, review);
});

export default reviewsRouter;
