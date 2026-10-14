import express from "express";
import { prisma } from "../../lib/prismaClient.ts";
import { ok } from "../../lib/http.ts";

const dashboardRouter = express.Router();

/** GET /admin/dashboard/summary */
dashboardRouter.get("/summary", async (_req, res) => {
  const [totalProducts, activeProducts, totalOrders, paidOrders, totalComplaints, openComplaints] = await Promise.all([
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.product.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    prisma.order.count(),
    prisma.order.count({ where: { payment: "PAID" } }),
    prisma.complaint.count(),
    prisma.complaint.count({ where: { status: "OPEN" } }),
  ]);

  ok(res, {
    products: { total: totalProducts, active: activeProducts },
    orders: { total: totalOrders, paid: paidOrders },
    complaints: { total: totalComplaints, open: openComplaints },
  });
});

/** GET /admin/dashboard/metrics */
dashboardRouter.get("/metrics", async (_req, res) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [ordersLast7, revenueLast7, ordersLast30, revenueLast30] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: sevenDaysAgo }, payment: "PAID" },
      _sum: { totalCents: true },
    }),
    prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: thirtyDaysAgo }, payment: "PAID" },
      _sum: { totalCents: true },
    }),
  ]);

  ok(res, {
    last7Days: {
      orders: ordersLast7,
      revenueCents: revenueLast7._sum.totalCents ?? 0,
    },
    last30Days: {
      orders: ordersLast30,
      revenueCents: revenueLast30._sum.totalCents ?? 0,
    },
    });
});
export default dashboardRouter;
