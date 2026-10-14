"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface DiscountCode {
  id: string;
  code: string;
  percentOff: number;
  active: boolean;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  usesLeft: number | null;
  expired: boolean;
  createdAt: string;
}

/**
 * Discount codes, managed from the dashboard.
 *
 * A code is a percent off the whole order, checked live at checkout. Creating one here
 * is immediately redeemable; switching it off stops future checkouts without touching
 * past orders, which keep their own snapshot of what was taken off.
 */
function DiscountCodesCard() {
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [codesLoading, setCodesLoading] = useState(true);
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<DiscountCode[]>("/admin/discounts");
      setCodes(res.data);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not load discount codes");
    } finally {
      setCodesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !percent.trim()) {
      toast.error("A code and a percent off are required");
      return;
    }
    setCreating(true);
    try {
      const res = await api<DiscountCode>("/admin/discounts", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          percentOff: Number(percent),
          ...(expiresAt ? { expiresAt } : {}),
          ...(maxUses.trim() ? { maxUses: Number(maxUses) } : {}),
        }),
      });
      toast.success(res.message || `Code ${res.data.code} created`);
      setCode("");
      setPercent("");
      setExpiresAt("");
      setMaxUses("");
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not create the code");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(row: DiscountCode) {
    setBusyId(row.id);
    try {
      await api(`/admin/discounts/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !row.active }),
      });
      toast.success(`Code ${row.code} ${row.active ? "switched off" : "switched on"}`);
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not update the code");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: DiscountCode) {
    if (!window.confirm(`Delete code ${row.code}? Past orders keep their discount.`)) return;
    setBusyId(row.id);
    try {
      await api(`/admin/discounts/${row.id}`, { method: "DELETE" });
      toast.success(`Code ${row.code} deleted`);
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not delete the code");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discount codes</CardTitle>
        <CardDescription>
          Percent-off codes shoppers apply at checkout. Past orders keep their own
          snapshot, so editing here only changes future checkouts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="discount-code">Code</Label>
            <Input
              id="discount-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SAVE10"
              maxLength={32}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount-percent">Percent off</Label>
            <Input
              id="discount-percent"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="10"
              inputMode="numeric"
              type="number"
              min={1}
              max={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount-expiry">Expires (optional)</Label>
            <Input
              id="discount-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount-max-uses">Max uses (optional)</Label>
            <Input
              id="discount-max-uses"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Unlimited"
              inputMode="numeric"
              type="number"
              min={1}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={creating} className="w-full">
              {creating ? "Adding…" : "Add code"}
            </Button>
          </div>
        </form>

        {codesLoading ? (
          <div className="flex justify-center py-4">
            <Spinner className="size-5" />
          </div>
        ) : codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No codes yet. Add one above and shoppers can use it at checkout right away.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {codes.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {row.code} • {row.percentOff}% off
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Used {row.usedCount}
                    {row.maxUses !== null ? ` of ${row.maxUses}` : " times"}
                    {row.expiresAt
                      ? ` • expires ${new Date(row.expiresAt).toLocaleDateString()}`
                      : " • never expires"}
                  </p>
                </div>
                {row.expired ? (
                  <Badge variant="outline">Expired</Badge>
                ) : row.active ? (
                  <Badge>Active</Badge>
                ) : (
                  <Badge variant="outline">Off</Badge>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={row.active}
                    disabled={busyId === row.id}
                    onCheckedChange={() => void toggleActive(row)}
                    aria-label={`Switch code ${row.code} ${row.active ? "off" : "on"}`}
                  />
                  {row.active ? "On" : "Off"}
                </label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete code ${row.code}`}
                  disabled={busyId === row.id}
                  onClick={() => void remove(row)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
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
      <div className="mt-6">
        <DiscountCodesCard />
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
