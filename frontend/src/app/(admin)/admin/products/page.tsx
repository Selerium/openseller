"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackageSearch } from "lucide-react";
import AuthGate from "@/components/auth-gate";
import { formatMoney } from "@/lib/money";
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

interface ProductSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  minPriceCents: number;
  stockTotal: number;
  image: string | null;
}

/** `value` is what `?status=` accepts — ProductStatus in backend/prisma/schema.prisma. */
const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
];

/** Badge wording, derived from the options above so the two can never disagree. */
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

function ProductsPage() {
  const router = useRouter();
  const { params, result, loading, error, page, apply, goToPage, reload } =
    usePagedList<ProductSummary>("/admin/products");

  // Filters live in the URL (see usePagedList), so the controls read them straight from there:
  // one source of truth, and a shared link renders the same view.
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "";
  const hasFilters = Boolean(search || status);

  const clearFilters = () => apply({ search: null, status: null });

  /** Same rule as the orders list: the card is the link, but a click on a real <a> is not. */
  const openProduct = (event: React.MouseEvent<HTMLDivElement>, id: string) => {
    if ((event.target as HTMLElement).closest("a")) return;
    void router.push(`/admin/products/${id}`);
  };

  return (
    <Container className="max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Products</h1>
        <Button size="sm">Add Product</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ListSearchInput
          value={search}
          onApply={(value) => apply({ search: value })}
          label="Search products"
          placeholder="Search title or slug"
          className="w-full sm:w-64"
        />
        <ListFilterSelect
          value={status}
          options={STATUS_OPTIONS}
          onChange={(value) => apply({ status: value })}
          allLabel="All statuses"
          label="Filter by status"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {result?.total ?? 0} {result?.total === 1 ? "product" : "products"}
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Could not load products</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {/* First load only: once there is something to show, it stays on screen (dimmed) while
          the next page or filter loads, rather than flashing back to an empty spinner. */}
      {!error && loading && !result && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="size-6" />
        </div>
      )}

      {!error && !loading && result && result.items.length === 0 && (
        <div className="flex flex-col items-center gap-3 border border-dashed border-border py-20 text-center">
          <PackageSearch className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">
              {hasFilters
                ? "No products match these filters"
                : page > 1
                  ? "That page is past the end"
                  : "No products yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasFilters
                ? "Try clearing a filter or searching for something else."
                : page > 1
                  ? "There is nothing else beyond this page."
                  : "Add your first product to get started."}
            </p>
          </div>
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
          {!hasFilters && page > 1 && (
            <Button variant="outline" size="sm" onClick={() => goToPage(1)}>
              Go to page 1
            </Button>
          )}
        </div>
      )}

      {!error && result && result.items.length > 0 && (
        <>
          <div
            className={`space-y-4 ${
              loading ? "opacity-50 transition-opacity" : "transition-opacity"
            }`}
          >
            {result.items.map((p) => (
              <Card
                key={p.id}
                className="cursor-pointer transition-colors hover:border-foreground/25"
                onClick={(event) => openProduct(event, p.id)}
              >
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {p.image && (
                      // Plain <img> rather than next/image: /uploads is served by nginx on this
                      // origin, and adding a loader for it would buy nothing here.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt={p.title}
                        className="size-12 shrink-0 rounded-md border object-cover"
                      />
                    )}
                    <div>
                      <CardTitle>
                        <Link href={`/admin/products/${p.id}`} className="hover:underline">
                          {p.title}
                        </Link>
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">{p.slug}</p>
                    </div>
                  </div>
                  {/* The same words the status filter offers, so a badge and the dropdown that
                      finds it cannot describe the same state differently. */}
                  <Badge>{STATUS_LABELS[p.status] ?? p.status}</Badge>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {formatMoney(p.minPriceCents, "USD")} • {p.stockTotal} in stock
                  </div>
                  <Link
                    href={`/admin/products/${p.id}`}
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
            totalPages={result.totalPages}
            onPageChange={goToPage}
          />
        </>
      )}
    </Container>
  );
}

export default function AdminProductsRoute() {
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
        <ProductsPage />
      </Suspense>
    </AuthGate>
  );
}
