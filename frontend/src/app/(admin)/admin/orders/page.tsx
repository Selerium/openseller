"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGate from "@/components/auth-gate";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Container from "@/components/layout/container";
import {
  ListFilterSelect,
  ListPagination,
  ListSearchInput,
} from "@/components/admin/listControls";
import { usePagedList } from "@/hooks/usePagedList";
import {
  ORDER_FLOW,
  PAYMENT_LABELS,
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusLabel,
} from "@/lib/order-status";

interface OrderSummary {
  id: string;
  number: number;
  status: string;
  payment: string;
  totalCents: number;
  email: string | null;
  createdAt: string;
}

/**
 * The states worth a click of their own, in the order they happen. "All" clears the filter, so
 * it lives in the same row and reads as the first choice rather than as an escape hatch.
 */
const FILTERS = ["", ...ORDER_FLOW, "REFUNDED"] as const;

/** Payment states read from the same map the badges use, so the wording cannot drift apart. */
const PAYMENT_OPTIONS = Object.entries(PAYMENT_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function OrdersPage() {
  const router = useRouter();
  // Filters and page live in the URL (see usePagedList), so a filtered view is shareable, the
  // back button steps through filter history, and a refresh lands on the same results.
  const { params, result, loading, error, page, apply, goToPage, reload } =
    usePagedList<OrderSummary>("/admin/orders");

  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "";
  const payment = params.get("payment") ?? "";
  const hasFilters = Boolean(search || status || payment);

  const clearFilters = () => apply({ search: null, status: null, payment: null });

  /**
   * The whole card is the target, not just the two links on it: most clicks land on the
   * whitespace around the title, and a card that looks like one object should open as one
   * object. A click on an actual link is left alone so middle-click and "copy link address"
   * still behave the way the browser promises.
   */
  const openOrder = (event: React.MouseEvent<HTMLDivElement>, id: string) => {
    if ((event.target as HTMLElement).closest("a")) return;
    void router.push(`/admin/orders/${id}`);
  };

  return (
    <Container className="max-w-6xl p-6">
      <h1 className="mb-4 text-3xl font-bold">Orders</h1>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ListSearchInput
          value={search}
          onApply={(value) => apply({ search: value })}
          label="Search orders"
          placeholder="Search order number or email"
          className="w-full sm:w-64"
        />
        <ListFilterSelect
          value={payment}
          options={PAYMENT_OPTIONS}
          onChange={(value) => apply({ payment: value })}
          allLabel="All payments"
          label="Filter by payment"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value || "all"}
            type="button"
            onClick={() => apply({ status: value || null })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              status === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {value ? orderStatusLabel(value) : "All"}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Could not load orders</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : result?.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {search || payment
                ? "No orders match your search"
                : status
                  ? `No orders are ${orderStatusLabel(status).toLowerCase()}`
                  : "No orders yet"}
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-4">
            {result?.items.map((o) => (
              <Card
                key={o.id}
                className="cursor-pointer transition-colors hover:border-foreground/25"
                onClick={(event) => openOrder(event, o.id)}
              >
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="hover:underline"
                      >
                        Order #{o.number}
                      </Link>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {o.email ?? "guest"} • {new Date(o.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge className={orderStatusBadgeClass(o.status)}>
                      {orderStatusLabel(o.status)}
                    </Badge>
                    <Badge variant="outline">{paymentStatusLabel(o.payment)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <span className="font-semibold">
                    {formatMoney(o.totalCents, "USD")}
                  </span>
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Manage
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          <ListPagination
            page={page}
            totalPages={result?.totalPages ?? 1}
            onPageChange={goToPage}
          />
        </>
      )}
    </Container>
  );
}

export default function AdminOrdersRoute() {
  return (
    <AuthGate>
      {/* useSearchParams needs a Suspense boundary or `next build` refuses to prerender the
          route — dev tolerates its absence, production does not. Same note as the marketplace. */}
      <Suspense
        fallback={
          <div className="flex min-h-[60vh] items-center justify-center">
            <Spinner className="size-6" />
          </div>
        }
      >
        <OrdersPage />
      </Suspense>
    </AuthGate>
  );
}
