import crypto from "node:crypto";
import express from "express";
import AppError from "../../lib/appError.ts";
import { prisma, PaymentStatus } from "../../lib/prismaClient.ts";
import { ComplaintReason } from "../../generated/prisma/client.ts";
import checkTokens from "../../middleware/checkTokens.ts";
import notFoundHandler from "../../middleware/notFound.ts";

/**
 * Complaints: a dispute against something that was actually bought.
 *
 * Deliberately separate from reviews. A review rates a product; a complaint is a claim about a
 * specific delivery, which needs an order to hang off, a reason code, a status an admin moves
 * through, and a resolution. Filing one also writes an OrderEvent, so it shows up on the order
 * timeline without this endpoint knowing anything about how timelines are rendered.
 *
 * Two entry points, because a guest has no session: one authorised by a session, one by the
 * order's one-time token. Both funnel into `createComplaint`, so the two cannot drift.
 */
const complaintsRouter = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DETAILS = 2000;

function parseReason(value: unknown): ComplaintReason {
  if (typeof value !== "string" || !Object.values(ComplaintReason).includes(value as ComplaintReason)) {
    throw new AppError("A valid complaint reason is required", 400);
  }
  return value as ComplaintReason;
}

function parseDetails(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError("Please describe the problem", 400);
  }
  const cleaned = value.trim();
  if (!cleaned) throw new AppError("Please describe the problem", 400);
  // A complaint with no detail is unactionable. 2000 is generous enough that no customer will
  // hit it and short enough that one field cannot hold a novel.
  if (cleaned.length > MAX_DETAILS) {
    throw new AppError(`Please keep the description under ${MAX_DETAILS} characters`, 400);
  }
  return cleaned;
}

/**
 * Resolve the order and prove the caller is entitled to dispute it.
 *
 * A session works only for the order's own profile; a guest works only with the one-time token
 * handed back at checkout. Anything else is a 404 rather than a 403, so this cannot be used to
 * confirm that some other order id exists.
 */
async function authorise(
  orderId: string,
  req: express.Request,
): Promise<{ id: string; profileId: string | null; guestEmail: string | null }> {
  if (!UUID.test(orderId)) throw new AppError("Order not found", 404);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("Order not found", 404);

  const token = req.get("x-guest-token");
  const tokenOwns = Boolean(
    token &&
      order.guestTokenHash ===
        crypto.createHash("sha256").update(token).digest("hex"),
  );
  if (!tokenOwns && order.profileId !== req.user?.id) {
    throw new AppError("Order not found", 404);
  }

  return { id: order.id, profileId: order.profileId, guestEmail: order.guestEmail };
}

/**
 * Validate the body against the order, then write the complaint and its timeline entry.
 *
 * Both are written together but not in one transaction: they are independent rows and the
 * timeline is a convenience, so losing it must not cost the customer their complaint. The
 * complaint itself is the record of truth and is what the idempotency key protects.
 */
async function createComplaint(
  order: { id: string; profileId: string | null; guestEmail: string | null },
  body: unknown,
  fallbackProfileId: string | null,
) {
  const reason = parseReason((body ?? {})["reason"]);
  const details = parseDetails((body ?? {})["details"]);
  const orderItemId = (body ?? {})["orderItemId"];

  if (orderItemId !== undefined && orderItemId !== null) {
    if (typeof orderItemId !== "string" || !UUID.test(orderItemId)) {
      throw new AppError("Invalid order item", 400);
    }
    // Confirms the line belongs to this order. Without it, a customer could aim a complaint at
    // an OrderItem id from a different order and the admin would see it against the wrong
    // product.
    const line = await prisma.orderItem.findFirst({
      where: { id: orderItemId, orderId: order.id },
      select: { id: true },
    });
    if (!line) throw new AppError("Invalid order item", 400);
  }

  // Nothing was bought, so there is nothing to dispute. Checked on payment rather than on
  // status, because FULFILLED is still paid and CANCELLED-after-payment is still disputable.
  const paid = await prisma.order.findUnique({
    where: { id: order.id },
    select: { payment: true },
  });
  if (!paid || paid.payment !== PaymentStatus.PAID) {
    throw new AppError("Only a paid order can be disputed", 409);
  }

  const complaint = await prisma.complaint.create({
    data: {
      orderId: order.id,
      orderItemId: orderItemId ?? null,
      // A guest order adopted by a later sign-in already has a profileId; otherwise the
      // complainant is whoever is filing right now.
      profileId: order.profileId ?? fallbackProfileId,
      guestEmail: order.guestEmail,
      reason,
      details,
      status: "OPEN",
    },
    select: {
      id: true,
      orderItemId: true,
      reason: true,
      status: true,
      createdAt: true,
    },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      type: "complaint.opened",
      note: `Complaint opened (${reason})`,
    },
  });

  return complaint;
}

/** Guest entry point, authorised by the order token. */
complaintsRouter.post("/guest/:orderId", async (req, res) => {
  const order = await authorise(req.params.orderId, req);
  const complaint = await createComplaint(order, req.body, null);

  res.status(201).json({
    data: complaint,
    error: false,
    message: "Complaint submitted. We will be in touch.",
  });
});

// Everything below needs a session.
complaintsRouter.use(checkTokens);

complaintsRouter.post("/:orderId", async (req, res) => {
  const order = await authorise(req.params.orderId, req);
  const complaint = await createComplaint(order, req.body, req.user.id);

  res.status(201).json({
    data: complaint,
    error: false,
    message: "Complaint submitted. We will be in touch.",
  });
});

/** The complainant's own complaints, newest first. Admins get their own list in Phase 7. */
complaintsRouter.get("", async (req, res) => {
  const complaints = await prisma.complaint.findMany({
    where: { profileId: req.user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      orderId: true,
      orderItemId: true,
      reason: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      resolution: true,
      order: { select: { number: true } },
    },
  });

  res.status(200).json({ data: complaints, error: false, message: "" });
});

// Public reasons list for filing complaints
complaintsRouter.get("/reasons", async (req, res) => {
  const reasons = await prisma.complaintReason.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  res.status(200).json({ data: reasons, error: false, message: "" });
});

complaintsRouter.use(notFoundHandler);

export default complaintsRouter;