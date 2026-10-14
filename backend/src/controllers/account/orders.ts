import crypto from "node:crypto";
import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma } from "../../lib/prismaClient.ts";
import { config } from "../../lib/config.ts";
import { parsePage, pageOf } from "../../lib/http.ts";
import checkTokens from "../../middleware/checkTokens.ts";
import notFoundHandler from "../../middleware/notFound.ts";
import { MESSAGE_TAIL } from "../../lib/messages.ts";

/**
 * Order history.
 *
 * Two credential types reach the same data, so they are two routes rather than one route with an
 * optional parameter. A session proves "these are my orders"; a guest token proves "I am the
 * anonymous shopper who placed order X" and nothing else. Merging them would mean one endpoint
 * that is sometimes authenticated and sometimes not, which is exactly the shape that turns into
 * an authorisation bypass later.
 */
const ordersRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const detailInclude = {
  items: true,
  // adminOnly events are internal notes; a shopper must never see them, so they are filtered
  // out rather than relying on the client to hide them.
  events: { where: { adminOnly: false }, orderBy: { createdAt: "asc" as const } },
} as const;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toOrderSummary(order: {
  id: string;
  number: number;
  createdAt: Date;
  status: string;
  payment: string;
  currency: string;
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  items: { id: string; title: string; imageUrl: string | null; quantity: number }[];
  complaints?: { id: string; status: string }[];
}) {
  return {
    id: order.id,
    number: order.number,
    createdAt: order.createdAt,
    status: order.status,
    payment: order.payment,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCode: order.discountCode,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    items: order.items.map((item) => ({
      id: item.id,
      title: item.title,
      imageUrl: item.imageUrl,
      quantity: item.quantity,
    })),
    // Surfaced on the list so an order with an open dispute is visibly flagged without a second
    // request per row.
    openComplaints: (order.complaints ?? []).filter((c) => c.status === "OPEN").length,
  };
}

function toOrderDetail(
  order: Awaited<ReturnType<typeof loadOrder>>,
) {
  if (!order) throw new AppError("Order not found", 404);

  return {
    ...toOrderSummary(order),
    profileId: order.profileId,
    guestEmail: order.guestEmail,
    updatedAt: order.updatedAt,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    lines: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      title: item.title,
      variantName: item.variantName,
      sku: item.sku,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      // Line total is computed rather than stored, so it cannot drift from unitPrice x quantity.
      lineTotalCents: item.unitPriceCents * item.quantity,
    })),
    timeline: order.events.map((event) => ({
      id: event.id,
      type: event.type,
      note: event.note,
      createdAt: event.createdAt,
    })),
    complaints: (order.complaints ?? []).map((complaint) => {
      // Embedded tail: the newest page, oldest-first. `messageCount` says how much more
      // the thread can pull; the reader pages backwards through GET …/messages.
      const embedded = [...(complaint.messages ?? [])].slice(0, MESSAGE_TAIL).reverse();
      return {
        id: complaint.id,
        orderItemId: complaint.orderItemId,
        reason: complaint.reason,
        details: complaint.details,
        status: complaint.status,
        resolution: complaint.resolution,
        createdAt: complaint.createdAt,
        resolvedAt: complaint.resolvedAt,
        messageCount: complaint._count.messages,
        messages: embedded.map((message) => ({
          id: message.id,
          author: message.author,
          body: message.body,
          createdAt: message.createdAt,
        })),
      };
    }),
  };
}

// Newest-first at the query so `take` keeps the tail; the map above flips each page
// back to thread order. The +1th row is what says an older page exists.
const complaintThreadInclude = {
  messages: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: MESSAGE_TAIL + 1,
  },
  _count: { select: { messages: true } },
} as const;

function loadOrder(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      events: detailInclude.events,
      complaints: { include: complaintThreadInclude },
    },
  });
}

/**
 * Adopt guest orders that were placed with the signed-in shopper's email address.
 *
 * Without this, an order paid for as a guest would be invisible in the account the customer
 * signs into afterwards, which is the single most common way checkout feels broken.
 *
 * Safe because a session here implies a *verified* email address — checkTokens rejects
 * unverified accounts — so the caller has proven control of the mailbox that was used at
 * checkout. The guest token is left intact, so the original link keeps working too.
 */
async function claimGuestOrders(profileId: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { user: { select: { email: true } } },
  });
  if (!profile?.user.email) return;

  await prisma.order.updateMany({
    where: { profileId: null, guestEmail: profile.user.email },
    data: { profileId },
  });
}

/**
 * Public. A guest order is readable with the one-time token handed back at checkout.
 *
 * The raw token is never stored; only its sha256 is, so a database leak does not hand over
 * anybody's order history. The comparison is a database lookup on the digest rather than a scan,
 * and `guestTokenHash` is unique, so a token resolves to at most one order.
 *
 * The token is in a header rather than the query string so it stays out of access logs,
 * browser history and Referer headers.
 */
ordersRouter.get("/guest/:orderId", async (req, res) => {
  const { orderId } = req.params;
  if (!UUID.test(orderId)) throw new AppError("Order not found", 404);

  const token = req.get("x-guest-token");
  if (!token) throw new AppError("A guest order token is required", 401);

  const order = await prisma.order.findUnique({
    where: { guestTokenHash: sha256(token) },
    include: {
      items: true,
      events: detailInclude.events,
      complaints: { include: complaintThreadInclude },
    },
  });

  // A token for a different order is answered with 404, not 403: confirming that some other id
  // exists is itself a small leak, and the caller learns nothing useful from the difference.
  if (!order || order.id !== orderId) throw new AppError("Order not found", 404);

  res.status(200).json({ data: toOrderDetail(order), error: false, message: "" });
});

// Session required from here down.
//
// checkTokens is applied here rather than by adding "/orders" to the protected router's GUARDED
// list, because that list guards the entire prefix and would 401 the public token route above.
ordersRouter.use(checkTokens);

ordersRouter.get("", async (req, res) => {
  await claimGuestOrders(req.user.id);

  const { page, perPage, skip, take } = parsePage(req.query as Record<string, unknown>);

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { profileId: req.user.id },
      include: { items: true, complaints: { select: { id: true, status: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.order.count({ where: { profileId: req.user.id } }),
  ]);

  res.status(200).json({
    data: pageOf(orders.map(toOrderSummary), total, page, perPage),
    error: false,
    message: "",
  });
});

ordersRouter.get("/:orderId", async (req, res) => {
  const { orderId } = req.params;
  if (!UUID.test(orderId)) throw new AppError("Order not found", 404);

  const order = await loadOrder(orderId);
  // Scoped by profileId, so another shopper's order id is a 404 rather than a 403 that confirms
  // it exists.
  if (!order || order.profileId !== req.user.id) {
    throw new AppError("Order not found", 404);
  }

  res.status(200).json({ data: toOrderDetail(order), error: false, message: "" });
});

// Anything else under /orders is a 404 rather than a 401 from a misapplied token check.
ordersRouter.use(notFoundHandler);

export { loadOrder, toOrderDetail, toOrderSummary, claimGuestOrders };
export default ordersRouter;