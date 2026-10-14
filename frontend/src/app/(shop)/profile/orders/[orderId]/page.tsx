"use client";

import { useEffect, useState } from "react";
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

function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api<OrderDetail>(`/orders/${orderId}`);
        setOrder(res.data);
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };
    if (orderId) void load();
  }, [orderId]);

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
            <div className="flex justify-between pt-4 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(order.totalCents, order.currency)}</span>
            </div>
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
            />
          </div>
        </CardContent>
      </Card>
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
