"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/container";

interface ComplaintSummary {
  id: string;
  orderId: string;
  orderNumber: number;
  email: string | null;
  name: string | null;
  reason: string;
  status: string;
  details: string;
  messageCount: number;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

function statusVariant(status: string): "default" | "outline" | "secondary" {
  if (status === "OPEN") return "default";
  if (status === "RESOLVED") return "secondary";
  return "outline";
}

function ComplaintsPage() {
  const [data, setData] = useState<Page<ComplaintSummary> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api<Page<ComplaintSummary>>("/admin/complaints");
        setData(res.data);
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <Container className="max-w-6xl p-6">
      <h1 className="mb-6 text-3xl font-bold">Complaints</h1>
      {(data?.items.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No complaints. Quiet shop, happy customers.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data?.items.map((c) => (
            // The whole card is the link: clicking a complaint opens it on its order, with
            // the timeline above and the reply thread below, so triage never leaves this list.
            <Link key={c.id} href={`/admin/complaints/${c.id}`} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle>
                      Order #{c.orderNumber}
                      {c.name ? ` • ${c.name}` : ""}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {c.reason.replace(/_/g, " ")} • {new Date(c.createdAt).toLocaleString()}
                      {c.email ? ` • ${c.email}` : ""}
                      {c.messageCount > 0 &&
                        ` • ${c.messageCount} ${c.messageCount === 1 ? "reply" : "replies"}`}
                    </p>
                  </div>
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{c.details}</p>
                  <Button variant="link" size="sm" className="mt-1 h-auto p-0" asChild>
                    <span>Open complaint →</span>
                  </Button>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}

export default function AdminComplaintsRoute() {
  return (
    <AuthGate>
      <ComplaintsPage />
    </AuthGate>
  );
}
