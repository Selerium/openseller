import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma, OrderStatus, PaymentStatus } from "../../lib/prismaClient.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { ok, pageOf, parsePage, STABLE_ID_ORDER } from "../../lib/http.ts";
import { stripeClient } from "../../lib/stripe.ts";
import { notify } from "../../lib/notify.ts";
import { MESSAGE_TAIL } from "../../lib/messages.ts";

const ordersRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Profile is selected field by field rather than `include: { user: true }`: User carries the
 * password hash, and a detail response that hands the whole row back would put it on the wire
 * for anyone who can read an admin page (or a proxy log).
 */
const detailInclude = {
  profile: {
    select: {
      id: true,
      name: true,
      user: { select: { email: true } },
    },
  },
  items: { orderBy: { title: "asc" as const } },
  events: { orderBy: { createdAt: "asc" as const } },
  complaints: {
    orderBy: { createdAt: "desc" as const },
    include: {
      // Newest-first so `take` keeps the tail; the map flips each page to thread order.
      messages: {
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        take: MESSAGE_TAIL + 1,
      },
      _count: { select: { messages: true } },
    },
  },
} as const;

function isOrderStatus(value: string): boolean {
  return Object.hasOwn(OrderStatus, value);
}

function isPaymentStatus(value: string): boolean {
  return Object.hasOwn(PaymentStatus, value);
}

type DetailOrder = NonNullable<Awaited<ReturnType<typeof loadDetail>>>;

function loadDetail(where: Prisma.OrderWhereInput) {
  return prisma.order.findFirst({ where, include: detailInclude });
}

function toOrderSummary(order: {
  id: string;
  number: number;
  status: string;
  payment: string;
  totalCents: number;
  currency: string;
  openComplaints: number;
  profileId: string | null;
  guestEmail: string | null;
  profile?: { user: { email: string } | null } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    payment: order.payment,
    totalCents: order.totalCents,
    currency: order.currency,
    // Counted from the rows in hand so the flag on a list row cannot disagree with the
    // complaint list behind it.
    openComplaints: order.openComplaints,
    profileId: order.profileId,
    // Profile has no email column of its own; the address lives on User. Reading it straight
    // off the profile would render every account order as "guest".
    email: order.profile?.user?.email ?? order.guestEmail,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

async function toOrderDetail(order: DetailOrder | null) {
  if (!order) throw new AppError("Order not found", 404);

  // Reviews the buyer left on the products in *this* order.
  //
  // A review has no orderId — it is a statement about a product — so the link is the pair
  // (profile, productId) that this order proves. Guests have no profile and so cannot have
  // written one until they claim the order, which is why a profile-less order simply has none
  // rather than being a special case to render.
  const productIds = [...new Set(order.items.map((item) => item.productId))];
  const reviews =
    order.profileId && productIds.length > 0
      ? await prisma.review.findMany({
          where: { profileId: order.profileId, productId: { in: productIds } },
          orderBy: [{ createdAt: "desc" }, STABLE_ID_ORDER],
          select: {
            id: true,
            productId: true,
            rating: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
          },
        })
      : [];

  // Title comes off the order line rather than a product read: the line is a snapshot that
  // still says what was bought even if the product has since been renamed or deleted.
  const titleByProduct = new Map(order.items.map((item) => [item.productId, item.title]));

  return {
    ...toOrderSummary({
      ...order,
      // Counted from the rows in hand rather than a stored column, so it cannot drift from
      // what the item list below shows.
      openComplaints: order.complaints.filter((c) => c.status === "OPEN").length,
    }),
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    guestEmail: order.guestEmail,
    buyerName: order.profile?.name ?? null,
    subtotalCents: order.subtotalCents,
    discountCode: order.discountCode,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    stripeCheckoutSessionId: order.stripeCheckoutSessionId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      title: item.title,
      variantName: item.variantName,
      sku: item.sku,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      lineTotalCents: item.unitPriceCents * item.quantity,
    })),
    timeline: order.events.map((event) => ({
      id: event.id,
      type: event.type,
      note: event.note,
      adminOnly: event.adminOnly,
      createdAt: event.createdAt,
    })),
    complaints: order.complaints.map((complaint) => ({
      id: complaint.id,
      reason: complaint.reason,
      status: complaint.status,
      details: complaint.details,
      resolution: complaint.resolution,
      createdAt: complaint.createdAt,
      messageCount: complaint._count.messages,
      messages: [...complaint.messages].slice(0, MESSAGE_TAIL).reverse().map((message) => ({
        id: message.id,
        author: message.author,
        body: message.body,
        createdAt: message.createdAt,
      })),
    })),
    reviews: reviews.map((review) => ({
      id: review.id,
      productId: review.productId,
      productTitle: titleByProduct.get(review.productId) ?? null,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status,
      createdAt: review.createdAt,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** GET /admin/orders */
ordersRouter.get("", async (req, res) => {
  const { page, perPage, skip, take } = parsePage(req.query);
  const search = String(req.query.search ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const payment = String(req.query.payment ?? "").trim();

  // Refused with a 400 rather than passed through: an unknown enum value is a Prisma
  // validation error, and a filter typo rendering as a 500 tells an admin nothing.
  if (status && !isOrderStatus(status)) throw new AppError("Unknown status filter", 400);
  if (payment && !isPaymentStatus(payment)) throw new AppError("Unknown payment filter", 400);

  // An all-digit search doubles as an exact order number, because that is what an admin
  // hunting for one specific order types. The bound keeps it inside the Int32 range of
  // `number`, so a long digit string can only ever match emails instead of blowing up the
  // query. Emails match either contact: the guest one, or the account address on profile.user.
  const asOrderNumber = Number(search);
  const digits = /^\d+$/.test(search) && asOrderNumber <= 2147483647 ? asOrderNumber : null;

  const where: Prisma.OrderWhereInput = {
    ...(status ? { status: status as OrderStatus } : {}),
    ...(payment ? { payment: payment as PaymentStatus } : {}),
    ...(search
      ? {
          OR: [
            ...(digits !== null ? [{ number: digits }] : []),
            { guestEmail: { contains: search, mode: "insensitive" as const } },
            {
              profile: {
                user: { email: { contains: search, mode: "insensitive" as const } },
              },
            },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.OrderOrderByWithRelationInput[] = [{ createdAt: "desc" }, STABLE_ID_ORDER];

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        profile: {
          select: { user: { select: { email: true } } },
        },
        complaints: { where: { status: "OPEN" }, select: { id: true } },
      },
    }),
  ]);

  ok(
    res,
    pageOf(
      orders.map((order) =>
        toOrderSummary({ ...order, openComplaints: order.complaints.length }),
      ),
      total,
      page,
      perPage,
    ),
  );
});

/** GET /admin/orders/:id — accepts the id or the human-facing order number. */
ordersRouter.get("/:id", async (req, res) => {
  const order = await loadDetail(findWhere(req.params.id));
  if (!order) throw new AppError("Order not found", 404);

  ok(res, await toOrderDetail(order));
});

/**
 * PATCH /admin/orders/:id — the two state changes an admin drives by hand.
 *
 * Only FULFILLED (delivered) and CANCELLED are accepted. Payment is deliberately not writable
 * from here: `payment` is a fact recorded by the party that took the money, and a status
 * endpoint that could set an order to PAID would be a way to create paid orders for free.
 *
 * Every transition is checked against the row as it stands, and refused with a 409 rather than
 * silently "corrected":
 *
 *   - deliver requires payment = PAID and status = PAID. Marking an unpaid order delivered
 *     would tell the fulfilment desk something untrue, and delivering an already-cancelled
 *     order would resurrect it.
 *   - cancel is refused on FULFILLED and REFUNDED. Both are terminal facts (the goods went out,
 *     or the money went back) that an order must not quietly undo.
 *   - cancelling a PAID order is allowed — a store does run out of stock after taking money —
 *     but the money is not refunded by this app, so a second admin-only note lands on the
 *     timeline saying the customer is owed one.
 *
 * Repeating a change is a no-op that answers 200, so a double-click cannot put two "status
 * changed" entries on a customer's timeline.
 */
ordersRouter.patch("/:id", async (req, res) => {
  const order = await prisma.order.findFirst({ where: findWhere(req.params.id) });
  if (!order) throw new AppError("Order not found", 404);

  const status = String(req.body?.status ?? "").trim().toUpperCase();
  if (status !== "FULFILLED" && status !== "CANCELLED") {
    throw new AppError("status must be FULFILLED (delivered) or CANCELLED", 400);
  }

  if (order.status === status) {
    return ok(
      res,
      await toOrderDetail(await loadDetail({ id: order.id })),
      `Order is already ${status === "FULFILLED" ? "delivered" : "cancelled"}`,
    );
  }

  if (status === "FULFILLED") {
    if (order.payment !== PaymentStatus.PAID) {
      throw new AppError("Only a paid order can be marked delivered", 409);
    }
    if (order.status !== OrderStatus.PAID) {
      throw new AppError(
        `An order that is ${order.status.toLowerCase()} cannot be marked delivered`,
        409,
      );
    }
  } else if (order.status === OrderStatus.FULFILLED || order.status === OrderStatus.REFUNDED) {
    throw new AppError(
      `An order that is ${order.status.toLowerCase()} cannot be cancelled`,
      409,
    );
  }

  const paidBeforeCancel = status === "CANCELLED" && order.payment === PaymentStatus.PAID;
  const events: { type: string; note: string; adminOnly?: boolean }[] = [
    {
      type: "status.changed",
      note: status === "FULFILLED" ? "Marked as delivered" : "Order cancelled",
    },
    ...(paidBeforeCancel
      ? [
          {
            type: "note.added",
            note: "Cancelled after payment: the customer is owed a refund.",
            adminOnly: true,
          },
        ]
      : []),
  ];

  // Status and its timeline land together. A cancelled order whose timeline never says so is
  // support work that starts with a database query.
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.order.update({ where: { id: order.id }, data: { status } });
    await tx.orderEvent.createMany({
      data: events.map((event) => ({ orderId: order.id, ...event })),
    });
    return next;
  });

  ok(
    res,
    await toOrderDetail(await loadDetail({ id: updated.id })),
    status === "FULFILLED" ? "Order marked as delivered" : "Order cancelled",
  );

  // The shopper's inbox, not the timeline: the timeline is already written above, and a
  // guest order (no profile) has nobody to notify.
  if (updated.profileId) {
    void notify(updated.profileId, {
      type: "order.status",
      title:
        status === "FULFILLED"
          ? `Order #${updated.number} delivered`
          : `Order #${updated.number} cancelled`,
      body:
        status === "FULFILLED"
          ? "Your order was marked as delivered."
          : paidBeforeCancel
            ? "Your order was cancelled after payment — a refund is owed; support will be in touch."
            : "Your order was cancelled.",
      link: `/profile/orders/${updated.id}`,
    }).catch(() => {});
  }
});

/**
 * POST /admin/orders/:id/refund — return the money on a paid order.
 *
 * The rule is deliberately narrower than "any order an admin is looking at": only payment =
 * PAID can be refunded, because a refund without money held is not a refund, and refunding an
 * unpaid order would record a payout that never happened. A PAID order can be refunded from
 * any of its statuses (in progress, cancelled after payment, even delivered — a return is a
 * normal event), and the pair of flags moves together so no screen can show an order as
 * refunded while its payment still reads PAID.
 *
 * The money moves first and the row follows. If Stripe refuses — card already dispute-resolved,
 * network down, key missing — nothing is written and the order is exactly as it was, which is
 * the only ordering where a failure cannot leave the database claiming a payout that never
 * happened. The reverse failure (row written, Stripe call lost) would be much harder to
 * reconcile.
 *
 * Idempotent by outcome rather than by key: an already-refunded order answers 200 with a
 * message instead of erroring, so a double-click cannot pay twice. The `Idempotency-Key` the
 * UI sends covers the harder case — a retry after the connection dropped mid-refund.
 */
ordersRouter.post("/:id/refund", async (req, res) => {
  const order = await prisma.order.findFirst({ where: findWhere(req.params.id) });
  if (!order) throw new AppError("Order not found", 404);

  if (order.payment === PaymentStatus.REFUNDED || order.status === OrderStatus.REFUNDED) {
    return ok(
      res,
      await toOrderDetail(await loadDetail({ id: order.id })),
      "Order is already refunded",
    );
  }

  if (order.payment !== PaymentStatus.PAID) {
    throw new AppError("Only a paid order can be refunded", 409);
  }

  // No payment intent means the money was never taken through Stripe: a mock payment (see
  // ALLOW_MOCK_PAYMENTS in lib/config.ts) records PAID without charging anyone, so there is
  // simply nothing to hand back — the record below is the whole of the refund.
  let refundId: string | null = null;
  if (order.stripePaymentIntentId) {
    try {
      const refund = await stripeClient().refunds.create({
        payment_intent: order.stripePaymentIntentId,
      });
      refundId = refund.id;
    } catch (error) {
      // A missing key is already an AppError (503) and says which variable to set; anything
      // else is Stripe refusing the payout, and the order stays untouched either way.
      if (error instanceof AppError) throw error;
      const detail = error instanceof Error ? error.message : "unknown error";
      throw new AppError(`Stripe could not refund this order: ${detail}`, 502);
    }
  }

  // Inventory is deliberately *not* returned to stock. The goods may be sitting in a customer's
  // house, damaged in transit, or restocked by hand after inspection — a refund says the money
  // went back, nothing about what came back — and the cancel path has never restocked either.
  // Restock is an edit on the product, where the count can be checked against reality.
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, payment: PaymentStatus.PAID },
      data: { status: OrderStatus.REFUNDED, payment: PaymentStatus.REFUNDED },
    });
    // A second admin cannot have won this race (Stripe refuses a second refund on the same
    // intent above), but guarding keeps the invariant true even if that ever changes.
    if (count === 0) throw new AppError("Order was already refunded", 409);

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "refund.issued",
        note: refundId ? `Refund issued (${refundId})` : "Refund recorded",
      },
    });
  });

  ok(
    res,
    await toOrderDetail(await loadDetail({ id: order.id })),
    refundId ? "Refund issued" : "Refund recorded",
  );

  if (order.profileId) {
    void notify(order.profileId, {
      type: "order.status",
      title: `Order #${order.number} refunded`,
      body: "The money is on its way back to the original payment method.",
      link: `/profile/orders/${order.id}`,
    }).catch(() => {});
  }
});

/**
 * Resolve the path parameter, which is an id or an order number.
 *
 * `Number(id) || -1` rather than a bare Number: "orders/latest" is NaN, and a number column
 * compared against NaN is a query Prisma refuses to build.
 */
function findWhere(id: string): Prisma.OrderWhereInput {
  return UUID.test(id) ? { id } : { number: Number(id) || -1 };
}

export default ordersRouter;
