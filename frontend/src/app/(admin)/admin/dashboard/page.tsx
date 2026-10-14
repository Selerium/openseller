"use client";

import { useEffect, useState } from "react";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import Container from "@/components/layout/container";

interface Summary {
  products: { total: number; active: number };
  orders: { total: number; paid: number };
  complaints: { total: number; open: number };
}

interface Metrics {
  last7Days: { orders: number; revenueCents: number };
  last30Days: { orders: number; revenueCents: number };
}

function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, m] = await Promise.all([
          api<Summary>("/admin/dashboard/summary"),
          api<Metrics>("/admin/dashboard/metrics"),
        ]);
        setSummary(s.data);
        setMetrics(m.data);
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
      <h1 className="mb-6 text-3xl font-bold">Admin Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Products</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.products.total ?? 0}</p>
            <p className="text-sm text-muted-foreground">{summary?.products.active ?? 0} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.orders.total ?? 0}</p>
            <p className="text-sm text-muted-foreground">{summary?.orders.paid ?? 0} paid</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Complaints</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary?.complaints.total ?? 0}</p>
            <p className="text-sm text-muted-foreground">{summary?.complaints.open ?? 0} open</p>
          </CardContent>
        </Card>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{metrics?.last7Days.orders ?? 0} orders</p>
            <p className="text-lg font-semibold">{formatMoney(metrics?.last7Days.revenueCents ?? 0, "USD")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Last 30 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{metrics?.last30Days.orders ?? 0} orders</p>
            <p className="text-lg font-semibold">{formatMoney(metrics?.last30Days.revenueCents ?? 0, "USD")}</p>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}

export default function AdminDashboardRoute() {
  return (
    <AuthGate>
      <DashboardPage />
    </AuthGate>
  );
}
