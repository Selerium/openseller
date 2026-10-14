"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { api } from "@/lib/api";
import ProductCard, {
  type ProductCardData,
} from "@/components/storefront/productCard";
import FilterSidebar from "@/components/storefront/filterSidebar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CategorySummary, Paged } from "@/components/storefront/types";
import Container from "@/components/layout/container";

const PER_PAGE = 24;

/**
 * Marketplace grid.
 *
 * Client-rendered with the filter state in the URL rather than server-rendered from
 * `searchParams`. Two reasons: the filters drive `useSearchParams`, so the page has to be on the
 * client to re-render without a full navigation anyway; and a server component would need an
 * absolute API origin to fetch (a relative "/products" has nothing to resolve against on the
 * server), which means threading request headers through to rebuild the origin the browser
 * already has for free.
 *
 * Each filter change produces a new URL, which is what makes a filtered view shareable and the
 * back button step through filter history.
 *
 * Split out from the default export below because it calls useSearchParams, which Next refuses to
 * statically render outside a Suspense boundary. The boundary has to sit in this file: a
 * `loading.tsx` would defer the whole route, so the shell would not stream while the client
 * re-fetches on every filter change.
 */
function MarketplaceGrid() {
  const params = useSearchParams();
  const router = useRouter();

  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [result, setResult] = useState<Paged<ProductCardData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Changing a filter invalidates whatever was on screen, and a stale grid next to fresh filter
  // controls reads as "these are the results". Hiding it and showing skeletons is honest; showing
  // old results would not be.
  const query = params.toString();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [products, cats] = await Promise.all([
        api<Paged<ProductCardData>>(`/products?${query}${query ? "&" : ""}perPage=${PER_PAGE}`),
        // categories only need fetching once, but they are cheap and this keeps the code to one
        // effect; caching them would need a provider for no measurable gain on a four-item list
        api<CategorySummary[]>("/categories"),
      ]);

      setResult(products.data);
      setCategories(cats.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  // Same router.replace the sidebar uses, so paging does not tear down and rebuild the whole app
  // the way a full navigation would, and so the two stay consistent if either changes.
  const goToPage = useCallback(
    (target: number) => {
      const next = new URLSearchParams(params.toString());
      // page=1 is the default, so it is left out of the URL rather than pinned to it: a clean
      // link and a ?page=1 link should not be two different bookmarks.
      if (target <= 1) next.delete("page");
      else next.set("page", String(target));

      const query = next.toString();
      router.replace(query ? `/marketplace?${query}` : "/marketplace", {
        scroll: false,
      });
    },
    [params, router]
  );

  const page = Number(params.get("page") ?? "1");
  const totalPages = result?.totalPages ?? 1;
  const showSkeletons = loading && !result;

  return (
    <Container className="flex flex-col gap-6 py-6 lg:flex-row">
      <FilterSidebar categories={categories} total={result?.total ?? 0} />

      <div className="min-w-0 flex-1">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Could not load the marketplace</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={load}>
              Try again
            </Button>
          </div>
        )}

        {!error && showSkeletons && <GridSkeleton />}

        {!error && !showSkeletons && result && result.items.length === 0 && (
          <div className="flex flex-col items-center gap-3 border border-dashed border-border py-20 text-center">
            <PackageSearch className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No products match these filters</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try clearing a filter or searching for something else.
              </p>
            </div>
          </div>
        )}

        {!error && result && result.items.length > 0 && (
          <>
            {/* The container owns the top and left rules and each cell owns its right and bottom,
                so the internal lines are shared rather than doubled and no cell needs to know its
                position. This works at any column count, which is why it beats gap + per-cell
                borders for a grid that reflows. */}
            <div
              className={`grid grid-cols-2 border-t border-l border-border sm:grid-cols-3 xl:grid-cols-4 ${
                loading ? "opacity-50 transition-opacity" : "transition-opacity"
              }`}
            >
              {result.items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-6 flex items-center justify-center gap-1"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="px-3 text-sm text-muted-foreground tabular-nums">
                  Page {result.page} of {result.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </Container>
  );
}

/**
 * Grid-shaped loading placeholder.
 *
 * Mirrors the real grid's column and border classes exactly. A skeleton that does not match the
 * layout it stands in for is worse than no skeleton: the page reflows when the data lands, which
 * is the jolt the skeleton exists to prevent.
 *
 * The cell count is a full screen's worth rather than PER_PAGE — a 24-cell skeleton is a very long
 * scroll of grey before anything appears, and the rows below the fold were never going to be seen.
 */
function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 border-t border-l border-border sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="border-r border-b border-border p-3">
          <Skeleton className="mb-3 aspect-square w-full rounded-md" />
          <Skeleton className="mb-1.5 h-3.5 w-3/4" />
          <Skeleton className="mb-1.5 h-3 w-full" />
          <Skeleton className="mb-2 h-3 w-1/2" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/**
 * Route entry point.
 *
 * The Suspense boundary is what lets the rest of this file call useSearchParams: without it Next
 * refuses to prerender the route and `next build` fails with "useSearchParams() should be wrapped
 * in a suspense boundary". `next dev` tolerates the missing boundary, so this only surfaces in a
 * production build — the worst place to discover it.
 */
export default function MarketplacePage() {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <MarketplaceGrid />
    </Suspense>
  );
}