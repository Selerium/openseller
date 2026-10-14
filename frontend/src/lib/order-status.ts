/**
 * Order state in the words a customer reads.
 *
 * The database speaks enums (PENDING_PAYMENT / PAID / FULFILLED / ...) because those are the
 * states the transitions are validated against. Nobody wants to be told their order is
 * "FULFILLED", so every screen runs the raw value through here instead of each page inventing
 * its own wording — which is how one page ended up promising "PAID" while another said "paid"
 * and a third said nothing at all.
 *
 * The mapping is display only. `PAID` is the state an order sits in while the store is working
 * on it, so it reads as "In progress"; `FULFILLED` is what the fulfilment desk sets when the
 * parcel goes out, so it reads as "Delivered".
 */

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAID: "In progress",
  FULFILLED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

export function paymentStatusLabel(payment: string): string {
  return PAYMENT_LABELS[payment] ?? payment;
}

/**
 * Colours keyed by the enum rather than by the label, so a badge cannot be tinted for wording
 * that does not exist, and a new status shows up neutral instead of unstyled.
 */
export function orderStatusBadgeClass(status: string): string {
  switch (status) {
    case "PENDING_PAYMENT":
      return "bg-yellow-500/10 text-yellow-600";
    case "PAID":
      return "bg-blue-500/10 text-blue-600";
    case "FULFILLED":
      return "bg-green-500/10 text-green-600";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/**
 * What the admin UI offers for an order right now.
 *
 * Deliberately mirrors the rules PATCH /admin/orders/:id enforces. The server refuses these
 * same transitions with a 409; hiding the button is the courtesy copy of that check, not a
 * substitute for it.
 */
export function canMarkDelivered(order: { status: string; payment: string }): boolean {
  return order.status === "PAID" && order.payment === "PAID";
}

export function canCancelOrder(order: { status: string }): boolean {
  return order.status === "PENDING_PAYMENT" || order.status === "PAID";
}

/**
 * Refund is decided on the *money*, not the order status: while the store still holds payment
 * it can hand it back, whether the order is in progress, was cancelled after payment, or was
 * delivered and is now coming back. Mirrors POST /admin/orders/:id/refund, which refuses
 * everything but payment = PAID with the same rule.
 */
export function canRefund(order: { payment: string }): boolean {
  return order.payment === "PAID";
}

/** The happy path a shopper watches their order travel along. */
export const ORDER_FLOW = ["PENDING_PAYMENT", "PAID", "FULFILLED"] as const;

/** Index of a status in ORDER_FLOW; anything terminal (cancelled, refunded) reads as step 0. */
export function flowIndex(status: string): number {
  const index = (ORDER_FLOW as readonly string[]).indexOf(status);
  return index === -1 ? 0 : index;
}
