import express from "express";
import categoriesRouter from "./categories.ts";
import productsRouter from "./products.ts";
import reviewsRouter from "./reviews.ts";
import homepageRouter from "./homepage.ts";

/**
 * Everything under here is reachable without authentication, so it must be mounted BEFORE the
 * protected router in app.ts (that mount applies checkTokens to every route after it).
 */
const catalogRouter = express.Router();

// reviews first: it owns /products/:productKey/reviews, which productsRouter does not match
catalogRouter.use("/categories", categoriesRouter);
catalogRouter.use("/products", reviewsRouter);
catalogRouter.use("/products", productsRouter);
catalogRouter.use("/homepage", homepageRouter);

export default catalogRouter;
