"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/container";
import ComplaintDialog from "@/components/storefront/complaintDialog";
import ReviewDialog from "@/components/storefront/reviewDialog";
import ComplaintThread, {
  type OlderPage,
  type ThreadComplaint,
  type ThreadMessage,
} from "@/components/complaints/complaintThread";
import { useLiveReload } from "@/components/complaints/useLiveReload";
import {
  ORDER_FLOW,
  flowIndex,
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusLabel,
} from "@/lib/order-status";

interface OrderDetail {
  id: string;
  number: number;
  status: string;
  payment: string;
  totalCents: number;
  subtotalCents: number;
  discountCode: string | null;
  discountCents: number;
  currency: string;
  itemCount: number;
  lines: Array<{
    id: string;
    title: string;
    variantName: string | null;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  timeline: Array<{
    id: string;
    type: string;
    note: string | null;
    createdAt: string;
  }>;
  complaints: ThreadComplaint[];
  createdAt: string;
}

/**
 * The three states a shopper waits through, with the current one marked.
 *
 * A cancelled or refunded order never reaches "Delivered", so it swaps the track for a plain
 * sentence — showing it three-quarters of the way through a journey it is not on would be
 * worse than saying nothing.
 */
function OrderProgress({ status }: { status: string }) {
  if (status === "CANCELLED" || status === "REFUNDED") {
    return (
      <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        {status === "CANCELLED"
          ? "This order was cancelled."
          : "This order was refunded."}
      </p>
    );
  }

  const current = flowIndex(status);

  return (
    <ol className="relative grid grid-cols-3">
      {/* Sits behind the markers, which have their own background, so it reads as a track
          connecting them rather than a rule struck through the row. */}
      <li
        aria-hidden
        className="absolute top-3 left-[16.6%] right-[16.6%] h-px bg-border"
      />
      {ORDER_FLOW.map((step, index) => {
        const reached = index <= current;
        return (
          <li key={step} className="relative flex flex-col items-center gap-2 text-center">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                reached
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-border bg-background text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                "text-xs",
                reached ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {orderStatusLabel(step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function UserComplaintCard({
  complaint,
  onSend,
}: {
  complaint: ThreadComplaint;
  onSend: (complaintId: string, body: string) => Promise<void>;
}) {
  // Older pages pull through the same endpoint the thread reads, authorised the same
  // way: a session, or the guest token for a still-guest order.
  async function loadOlder(beforeId: string): Promise<OlderPage> {
    const guestToken = sessionStorage.getItem("guestToken");
    const res = await api<{ items: ThreadMessage[]; hasMore: boolean }>(
      `/complaints/${complaint.id}/messages?before=${encodeURIComponent(beforeId)}&limit=20`,
      guestToken ? { headers: { "x-guest-token": guestToken } } : {},
    );
    return { messages: res.data.items, hasMore: res.data.hasMore };
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">
          Complaint • {complaint.reason.replace(/_/g, " ")}
        </CardTitle>
        <Badge variant={complaint.status === "OPEN" ? undefined : "outline"}>
          {complaint.status}
        </Badge>
      </CardHeader>
      <CardContent>
        <ComplaintThread
          complaint={complaint}
          viewer="customer"
          onSend={(body) => onSend(complaint.id, body)}
          closedHint="This complaint is closed — replying will reopen it."
          loadOlder={loadOlder}
        />
      </CardContent>
    </Card>
  );
}

function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api<OrderDetail>(`/orders/${orderId}`);
    setOrder(res.data);
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    load().catch(() => {}).finally(() => setLoading(false));
  }, [orderId, load]);

  // Live threads: support's replies (and resolutions) re-read the order as they arrive.
  // Draft text is safe — the reply box owns its state and survives the re-read.
  useLiveReload(
    (order?.complaints ?? []).map((c) => `complaint:${c.id}`),
    () => {
      void load();
    },
  );

  async function sendReply(complaintId: string, body: string) {
    // A guest order adopted after sign-in already carries a profile; a still-guest order
    // proves itself with the token from checkout, the same header filing uses.
    const guestToken = sessionStorage.getItem("guestToken");
    await api(`/complaints/${complaintId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
      ...(guestToken ? { headers: { "x-guest-token": guestToken } } : {}),
    });
    // Re-read rather than appending locally: a reply to a closed complaint reopens it, and
    // the badge, the hint and the thread all have to agree with the server afterwards.
    await load();
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!order) {
    return (
      <Container className="max-w-4xl p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Order not found</p>
            <Button asChild className="mt-4">
              <Link href="/profile/orders">Back to orders</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Order #{order.number}</h1>
        <Button variant="outline" asChild>
          <Link href="/profile/orders">Back</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {new Date(order.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge className={orderStatusBadgeClass(order.status)}>
                {orderStatusLabel(order.status)}
              </Badge>
              <Badge variant="outline">{paymentStatusLabel(order.payment)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <OrderProgress status={order.status} />
            <div className="space-y-4">
              {order.lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between border-b pb-4 last:border-0">
                  <div>
                    <p className="font-medium">{line.title}</p>
                    {line.variantName && (
                      <p className="text-sm text-muted-foreground">{line.variantName}</p>
                    )}
                    <p className="text-sm text-muted-foreground">Qty {line.quantity}</p>
                  </div>
                  <span className="tabular-nums">
                    {formatMoney(line.lineTotalCents, order.currency)}
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
                {order.discountCents > 0 && (
                  <div className="flex justify-between text-green-700 dark:text-green-400">
                    <dt>
                      Discount{order.discountCode ? ` (${order.discountCode})` : ""}
                    </dt>
                    <dd className="tabular-nums">
                      −{formatMoney(order.discountCents, order.currency)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between pt-2 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatMoney(order.totalCents, order.currency)}</dd>
                </div>
              </dl>
            </div>
            <div className="flex gap-2">
              <ReviewDialog
                orderId={order.id}
                items={(order as any).items || []}
                trigger={
                  <Button variant="outline" size="sm">
                    Review
                  </Button>
                }
              />
              <ComplaintDialog
                orderId={order.id}
                trigger={
                  <Button variant="outline" size="sm">
                    Report Complaint
                  </Button>
                }
                onSuccess={() => void load()}
              />
            </div>
          </CardContent>
        </Card>

        {/* Every complaint the shopper filed on this order, with its full thread: the
            description they wrote plus each reply from both sides, and a box to answer back.
            Newest first, matching the admin queue. */}
        {order.complaints.length > 0 && (
          <div className="flex flex-col gap-4">
            {order.complaints.map((complaint) => (
              <UserComplaintCard key={complaint.id} complaint={complaint} onSend={sendReply} />
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}

export default function OrderDetailRoute() {
  return (
    <AuthGate>
      <OrderDetailPage />
    </AuthGate>
  );
}
