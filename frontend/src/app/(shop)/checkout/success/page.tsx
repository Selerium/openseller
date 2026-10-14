"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";


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
import { useCart } from "@/lib/cart-context";
import Container from "@/components/layout/container";
import {
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusLabel,
} from "@/lib/order-status";

interface ConfirmResult {
  orderId: string;
  orderNumber: number;
  status: string;
  payment: string;
  paid: boolean;
  alreadyPaid: boolean;
}

/**
 * Stripe redirects here with ?session_id=..., and this page is where the order stops looking
 * unpaid. The server confirms the payment (POST /checkout/confirm) rather than the browser
 * trusting the redirect: landing on this URL only proves Stripe sent us, not that money moved.
 *
 * Retried a couple of times because the failure modes it absorbs are transient — a proxy that
 * dropped a response, or Stripe being momentarily unreachable from the server (reported as 502).
 * A 4xx, or the 503 that says payments are not configured on this box at all, is a real answer
 * and is shown straight away.
 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;

type Phase = "no-session" | "confirming" | "paid" | "unpaid" | "error";

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { clear, reconcile } = useCart();

  const [phase, setPhase] = useState<Phase>("confirming");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [message, setMessage] = useState("");
  // React 18 dev StrictMode runs effects twice, and each run would ask Stripe again. Confirming
  // is idempotent server-side, but there is no reason to pay for the duplicate calls.
  const started = useRef(false);

  useEffect(() => {
    void clear();
    void reconcile();
  }, []);

  const confirmPayment = useCallback(async () => {
    if (!sessionId) {
      setPhase("no-session");
      return;
    }

    // The guest token stays in sessionStorage: it is the only proof a guest has that this order
    // is theirs, both for this request and for filing a complaint later (the previous code
    // deleted it on mount, i.e. *before* anything could use it).
    const headers: Record<string, string> = {};
    const guestToken = sessionStorage.getItem("guestToken");
    if (guestToken) headers["x-guest-token"] = guestToken;

    setPhase("confirming");
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await api<ConfirmResult>("/checkout/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionId }),
        });
        setResult(res.data);
        setPhase(res.data.paid ? "paid" : "unpaid");
        setMessage(res.message);
        return;
      } catch (error: any) {
        const status: number | undefined = error?.status;
        const retryable =
          status === undefined || status === 500 || status === 502;
        if (!retryable || attempt === MAX_ATTEMPTS) {
          setPhase("error");
          setMessage(error?.message || "Could not confirm the payment");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }
  }, [sessionId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void confirmPayment();
  }, [confirmPayment]);

  return (
    <Container className="max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Payment successful</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-center">
          {phase === "confirming" && (
            <div className="flex flex-col items-center gap-3">
              <Spinner />
              <p className="text-sm text-muted-foreground">
                Confirming your payment…
              </p>
            </div>
          )}

          {phase === "paid" && result && (
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Thank you!</h2>
              <p className="text-muted-foreground">
                Payment confirmed for order #{result.orderNumber}. Check your
                email for confirmation.
              </p>
              <span
                className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${orderStatusBadgeClass(result.status)}`}
              >
                {orderStatusLabel(result.status)} ·{" "}
                {paymentStatusLabel(result.payment)}
              </span>
            </div>
          )}

          {phase === "unpaid" && (
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold">Thank you!</h2>
              <p className="text-muted-foreground">
                {message || "Your order has been received."} This usually
                settles within a few seconds — you can check again.
              </p>
              <Button variant="outline" onClick={() => void confirmPayment()}>
                Check again
              </Button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold">Thank you!</h2>
              <p className="text-destructive">
                {message || "Could not confirm the payment"} Your order has been
                placed either way; it updates automatically once the payment is
                verified.
              </p>
              <Button variant="outline" onClick={() => void confirmPayment()}>
                Try again
              </Button>
            </div>
          )}

          {phase === "no-session" && (
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Thank you!</h2>
              <p className="text-muted-foreground">
                Your order has been received. Check your email for confirmation.
              </p>
            </div>
          )}

          <Button asChild>
            <Link href="/marketplace">Continue shopping</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/profile/orders">View my orders</Link>
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><Spinner className="size-6" /></div>}>
      <SuccessContent />
    </Suspense>
  );
}
