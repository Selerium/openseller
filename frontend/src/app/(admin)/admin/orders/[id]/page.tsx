"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { useIdempotency } from "@/lib/idempotency";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Rating } from "@/components/ui/rating";
import Container from "@/components/layout/container";
import {
  canCancelOrder,
  canMarkDelivered,
  canRefund,
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusLabel,
} from "@/lib/order-status";

interface Address {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
}

interface AdminOrder {
  id: string;
  number: number;
  status: string;
  payment: string;
  currency: string;
  email: string | null;
  buyerName: string | null;
  guestEmail: string | null;
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  openComplaints: number;
  shippingAddress: Address;
  billingAddress: Address | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    title: string;
    variantName: string | null;
    sku: string | null;
    unitPriceCents: number;
    quantity: number;
    imageUrl: string | null;
    lineTotalCents: number;
  }>;
  timeline: Array<{
    id: string;
    type: string;
    note: string | null;
    adminOnly: boolean;
    createdAt: string;
  }>;
  complaints: Array<{
    id: string;
    reason: string;
    status: string;
    details: string;
    resolution: string | null;
    createdAt: string;
  }>;
  reviews: Array<{
    id: string;
    productId: string;
    productTitle: string | null;
    rating: number;
    title: string | null;
    body: string | null;
    status: string;
    createdAt: string;
  }>;
}

/**
 * A button that asks twice.
 *
 * Same shape, and the same reasoning, as components/homepage/confirmIconButton: these two
 * actions cannot be undone from this page — a delivered order cannot be walked back to "in
 * progress", and a cancelled one is a customer who has been told no — so the click that
 * performs the action must not be the click that was meant to reach for it. First press arms
 * (three seconds, then it disarms itself), second press goes through.
 */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      type="button"
      variant={armed ? "destructive" : "outline"}
      disabled={disabled}
      aria-pressed={armed}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

function formatAddress(address: Address | null | undefined): string[] {
  if (!address) return [];
  return [
    address.recipientName,
    address.line1,
    address.line2,
    [address.city, address.region].filter(Boolean).join(", "),
    [address.postalCode, address.countryCode].filter(Boolean).join(" "),
    address.phone,
  ].filter((line): line is string => Boolean(line));
}

function OrderActions({
  order,
  onApplied,
}: {
  order: AdminOrder;
  onApplied: (order: AdminOrder, message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const idem = useIdempotency();

  const change = async (status: "FULFILLED" | "CANCELLED") => {
    setBusy(true);
    try {
      const res = await api<AdminOrder>(`/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onApplied(res.data, res.message);
    } catch (e: any) {
      // The server refuses transitions this page has hidden, too — an order changed in another
      // tab between the render and the click. Its message is the useful part.
      toast.error(e?.message || "Could not update the order");
    } finally {
      setBusy(false);
    }
  };

  /**
   * The one action here that moves money, so it is the one wrapped in an idempotency key:
   * if the response to the first attempt never reaches the browser, the retry asks the API
   * "did that already happen?" instead of refunding a second time. The server checks the
   * order's own state as well — this is the belt, that is the braces.
   */
  const refund = async () => {
    setBusy(true);
    try {
      const res = await idem.run((idempotencyKey) =>
        api<AdminOrder>(`/admin/orders/${order.id}/refund`, {
          method: "POST",
          idempotencyKey,
        }),
      );
      onApplied(res.data, res.message || "Refund recorded");
    } catch (e: any) {
      toast.error(e?.message || "Could not refund the order");
    } finally {
      setBusy(false);
    }
  };

  const deliverable = canMarkDelivered(order);
  const cancellable = canCancelOrder(order);
  const refundable = canRefund(order);
  const actionable = deliverable || cancellable || refundable;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {deliverable && (
          <ConfirmButton
            label="Mark delivered"
            confirmLabel="Confirm: mark delivered"
            disabled={busy}
            onConfirm={() => void change("FULFILLED")}
          />
        )}
        {cancellable && (
          <ConfirmButton
            label="Cancel order"
            confirmLabel="Confirm: cancel order"
            disabled={busy}
            onConfirm={() => void change("CANCELLED")}
          />
        )}
        {refundable && (
          <ConfirmButton
            label="Refund"
            confirmLabel="Confirm: refund"
            disabled={busy}
            onConfirm={() => void refund()}
          />
        )}
      </div>

      {!actionable && <p className="text-sm text-muted-foreground">This order is closed.</p>}
      {!deliverable && order.status === "PENDING_PAYMENT" && (
        <p className="text-sm text-muted-foreground">
          Marking it delivered becomes available once the payment is confirmed.
        </p>
      )}
      {cancellable && order.payment === "PAID" && (
        <p className="text-sm text-muted-foreground">
          Cancelling does not move the money — refund the order too if the customer is owed one.
        </p>
      )}
      {refundable && (
        <p className="text-sm text-muted-foreground">
          Returns the {formatMoney(order.totalCents, order.currency)} to the original payment
          method. It does not put stock back on the shelf.
        </p>
      )}
      {busy && <Spinner className="size-4" />}
    </div>
  );
}

function OrderDetailPage() {
  const params = useParams();
  // The route is /admin/orders/[id], so the param is `id`. It used to be read as `orderId`,
  // which resolved to undefined on every load: the fetch hit /admin/orders/undefined, the API
  // answered 404, and every card in the order list led to a page saying "Order not found".
  const orderId = params.id as string;
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api<AdminOrder>(`/admin/orders/${orderId}`);
    setOrder(res.data);
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    const run = async () => {
      try {
        await load();
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!order) {
    return (
      <Container className="max-w-6xl p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Order not found</p>
            <Button asChild className="mt-4">
              <Link href="/admin/orders">Back to orders</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Order #{order.number}</h1>
          <Badge className={orderStatusBadgeClass(order.status)}>
            {orderStatusLabel(order.status)}
          </Badge>
          <Badge variant="outline">{paymentStatusLabel(order.payment)}</Badge>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/orders">Back to orders</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 border-b pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    {item.imageUrl && (
                      // Plain <img> rather than next/image: /uploads is served by nginx on this
                      // origin, and adding a loader for it would buy nothing here.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="size-12 rounded-md border object-cover"
                      />
                    )}
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {[item.variantName, item.sku].filter(Boolean).join(" • ")}
                        {item.variantName || item.sku ? " • " : ""}
                        Qty {item.quantity}
                      </p>
                    </div>
                  </div>
                  <span className="tabular-nums">
                    {formatMoney(item.lineTotalCents, order.currency)}
                  </span>
                </div>
              ))}

              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">
                    {formatMoney(order.subtotalCents, order.currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Shipping</dt>
                  <dd className="tabular-nums">
                    {formatMoney(order.shippingCents, order.currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="tabular-nums">
                    {formatMoney(order.taxCents, order.currency)}
                  </dd>
                </div>
                <div className="flex justify-between pt-2 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">
                    {formatMoney(order.totalCents, order.currency)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {order.timeline.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm">
                        {event.note ?? event.type}
                        {event.adminOnly && (
                          <Badge variant="outline" className="ml-2">
                            admin only
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{event.type}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {order.complaints.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Complaints</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {order.complaints.map((complaint) => (
                  <div key={complaint.id} className="border-b pb-4 last:border-0 last:pb-0">
                    <div className="mb-1 flex items-center justify-between gap-4">
                      <span className="font-medium">{complaint.reason}</span>
                      <Badge variant="outline">{complaint.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{complaint.details}</p>
                    {complaint.resolution && (
                      <p className="mt-1 text-sm">{complaint.resolution}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* The buyer's own words about what is in this order. A review hangs off a product,
              not an order, so it is only reachable here by matching the buyer's profile
              against the lines they bought — which is exactly the link the API resolves. */}
          {order.reviews.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Reviews by this customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {order.reviews.map((review) => (
                  <div key={review.id} className="border-b pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Rating value={review.rating} />
                        <span className="text-sm font-medium">
                          {review.title || `${review.rating} out of 5`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {review.status !== "PUBLISHED" && (
                          <Badge variant="outline">{review.status}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(review.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {review.productTitle && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        on {review.productTitle}
                      </p>
                    )}
                    {review.body && <p className="mt-1 text-sm">{review.body}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Fulfilment</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderActions
                order={order}
                onApplied={(updated, message) => {
                  setOrder(updated);
                  toast.success(message || "Order updated");
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{order.buyerName ?? "Guest checkout"}</p>
              <p className="text-muted-foreground">{order.email ?? "no email"}</p>
              <p className="text-muted-foreground">
                {order.itemCount} item{order.itemCount === 1 ? "" : "s"} • placed{" "}
                {new Date(order.createdAt).toLocaleString()}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shipping to</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5 text-sm">
              {formatAddress(order.shippingAddress).map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </CardContent>
          </Card>

          {/* Only when it differs: checkout copies shipping into billing for almost every
              order, and a second identical card would bury the one fact that matters —
              that a different address was billed. */}
          {order.billingAddress &&
            JSON.stringify(order.billingAddress) !== JSON.stringify(order.shippingAddress) && (
              <Card>
                <CardHeader>
                  <CardTitle>Billed to</CardTitle>
                </CardHeader>
                <CardContent className="space-y-0.5 text-sm">
                  {formatAddress(order.billingAddress).map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </CardContent>
              </Card>
            )}
        </div>
      </div>
    </Container>
  );
}

export default function AdminOrderDetailRoute() {
  return (
    <AuthGate>
      <OrderDetailPage />
    </AuthGate>
  );
}
