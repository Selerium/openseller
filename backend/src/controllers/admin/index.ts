import express from "express";
import requireAdmin from "../../middleware/requireAdmin.ts";
import uploadsRouter from "./uploads.ts";
import homepageRouter from "./homepage.ts";

/**
 * Mounted at /admin. Guarded here rather than per-route so a new admin endpoint is
 * admin-only by default instead of by remembering to add the middleware.
 */
const adminRouter = express.Router();

adminRouter.use(requireAdmin);
adminRouter.use("", uploadsRouter);
adminRouter.use("/homepage", homepageRouter);

export default adminRouter;

import productsRouter from "./products.ts";
adminRouter.use("/products", productsRouter);

import ordersRouter from "./orders.ts";
import complaintsRouter from "./complaints.ts";
import complaintReasonsRouter from "./complaint-reasons.ts";
import discountsRouter from "./discounts.ts";
adminRouter.use("/orders", ordersRouter);
adminRouter.use("/complaints", complaintsRouter);
adminRouter.use("/complaint-reasons", complaintReasonsRouter);
adminRouter.use("/discounts", discountsRouter);
import dashboardRouter from "./dashboard.ts";
import cleanupRouter from "./cleanup.ts";
adminRouter.use("/dashboard", dashboardRouter);
