"use client";

import { useEffect, useState } from "react";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Container from "@/components/layout/container";

interface ComplaintSummary {
  id: string;
  orderNumber: number;
  reason: string;
  status: string;
  details: string;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
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
      <div className="space-y-4">
        {data?.items.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Order #{c.orderNumber}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {c.reason} • {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
              <Badge>{c.status}</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{c.details}</p>
            </CardContent>
          </Card>
        ))}
      </div>
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
