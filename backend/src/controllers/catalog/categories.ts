import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import { ok } from "../../lib/http.ts";
import AppError from "../../lib/appError.ts";

const categoriesRouter = express.Router();

// Public: category list for the storefront filter sidebar.
categoriesRouter.get("", async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: { products: { where: { status: "ACTIVE", deletedAt: null } } },
      },
    },
  });

  ok(
    res,
    categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      productCount: category._count.products,
    })),
  );
});

categoriesRouter.get("/:slug", async (req, res) => {
  const category = await prisma.category.findUnique({
    where: { slug: req.params.slug },
    include: {
      _count: {
        select: { products: { where: { status: "ACTIVE", deletedAt: null } } },
      },
    },
  });

  if (!category) throw new AppError("Category not found", 404);

  ok(res, {
    id: category.id,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    productCount: category._count.products,
  });
});

export default categoriesRouter;
