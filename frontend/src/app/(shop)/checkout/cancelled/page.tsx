"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import Container from "@/components/layout/container";

/**
 * The page Stripe's cancel_url points at, and the reason an abandoned checkout stops reading
 * "Pending payment" in My orders.
 *
 * Stripe sends the shopper back here with ?order=<id> (see cancel_url in the checkout session),
 * and the first thing this page does is tell the server to cancel exactly that order. Without
 * this round trip the redirect changes nothing: the order it belonged to keeps its
 * PENDING_PAYMENT status, and the shopper is shown a "Payment cancelled" page while their
 * order history disagrees with it.
 *
 * The call is deliberately best-effort and silent. The page's own claim — the payment was
 * cancelled — is true whether or not the request lands, and the ways it can fail (an old link
 * with no order id, a guest who lost their token) are all cases where the existing sweeps are
 * the backstop anyway; surfacing an error here would only tell the shopper about plumbing they
 * cannot act on. The guest token rides along for the same reason the success page sends it:
 * for a guest it is the only proof the order is theirs.
 */
function CancelledContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order");
  // React 18 dev StrictMode runs effects twice, and each run would cancel again. The endpoint
  // is idempotent, but there is no reason to ask twice for the same answer.
  const started = useRef(false);

  useEffect(() => {
    if (!orderId || started.current) return;
    started.current = true;

    const headers: Record<string, string> = {};
    const guestToken = sessionStorage.getItem("guestToken");
    if (guestToken) headers["x-guest-token"] = guestToken;

    void api(`/checkout/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orderId }),
    }).catch(() => {});
  }, [orderId]);

  return (
    <Container className="max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Payment cancelled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-center">
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Your payment was cancelled. Your cart has been saved.
            </p>
          </div>
          <Button asChild>
            <Link href="/cart">Return to cart</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/marketplace">Continue shopping</Link>
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function CheckoutCancelledPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner className="size-6" />
        </div>
      }
    >
      <CancelledContent />
    </Suspense>
  );
}
