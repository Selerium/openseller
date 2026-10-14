"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Container from "@/components/layout/container";

interface MockPayResult {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  currency: string;
  alreadyPaid: boolean;
}

export default function MockPayPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const confirm = async () => {
      try {
        const guestToken = sessionStorage.getItem("guestToken");
        const headers: Record<string, string> = {};
        if (guestToken) headers["x-guest-token"] = guestToken;
        const res = await api<MockPayResult>(`/checkout/mock-pay/${orderId}`, {
          method: "POST",
          headers,
        });
        setStatus("success");
        setMessage(res.message || "Payment completed");
        // The guest token is kept on purpose: it is a bearer proof that this order is the
        // caller's (complaints, guest order lookup) and nothing hands it out a second time.
        setTimeout(() => router.push("/checkout/success"), 1000);
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message || "Payment failed");
      }
    };
    if (orderId) void confirm();
  }, [orderId, router]);

  return (
    <Container className="max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Processing mock payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-center">
          {status === "loading" && <Spinner />}
          {status === "success" && (
            <>
              <p className="text-sm text-muted-foreground">{message}</p>
              <p className="text-xs text-muted-foreground">
                Redirecting to success...
              </p>
            </>
          )}
          {status === "error" && (
            <>
              <p className="text-sm text-destructive">{message}</p>
              <Button asChild>
                <a href="/cart">Return to cart</a>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
