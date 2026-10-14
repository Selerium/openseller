"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { CategorySummary } from "@/components/storefront/types";

/**
 * Sort options.
 *
 * `value` is the API's `?sort=` vocabulary (backend/src/controllers/catalog/products.ts), so an
 * unknown value silently becomes "newest" server-side and the two can never disagree.
 *
 * Price is offered both ways because "sort by price" is ambiguous on its own — cheapest-first
 * and most-expensive-first are different orders and a shopper asking for one usually wants the
 * former. Alphabetical is ascending only; a descending A-Z is not a thing anyone asks for.
 */
const SORT_OPTIONS = [
  { value: "newest", label: "Recently added" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "title_asc", label: "Alphabetical" },
] as const;

const ALL_CATEGORIES = "__all__";

interface FilterSidebarProps {
  categories: CategorySummary[];
  /** Total matching the current filters, for the "Clear" affordance and the result count. */
  total: number;
}

export default function FilterSidebar({ categories, total }: FilterSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const search = params.get("search") ?? "";
  const category = params.get("category") ?? ALL_CATEGORIES;
  const sort = params.get("sort") ?? "newest";
  const discounted = params.get("discounted") === "true";
  const inStock = params.get("inStock") === "true";

  // The input is uncontrolled-ish: it keeps its own state so typing is not fought by the router,
  // and syncs back from the URL when the user navigates (back button, clear, a shared link).
  const [searchDraft, setSearchDraft] = useState(search);
  const lastSyncedSearch = useRef(search);

  useEffect(() => {
    if (search !== lastSyncedSearch.current) {
      lastSyncedSearch.current = search;
      setSearchDraft(search);
    }
  }, [search]);

  /**
   * Every filter change resets to page 1.
   *
   * Without this, narrowing a filter set while on page 4 lands the user on an empty page: the
   * new result set may only have two pages, and the browser happily renders page 4 of it as
   * "no results".
   */
  const apply = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());

      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === "false" || value === ALL_CATEGORIES) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }

      next.delete("page");

      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [params, pathname, router]
  );

  // Debounced so a search does not fire a request per keystroke. 300ms is long enough to skip
  // most intermediate states and short enough that the list feels like it is responding.
  useEffect(() => {
    if (searchDraft === search) return;
    const timer = setTimeout(() => apply({ search: searchDraft }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, search, apply]);

  const hasFilters =
    Boolean(search) ||
    category !== ALL_CATEGORIES ||
    sort !== "newest" ||
    discounted ||
    inStock;

  const clearAll = () => {
    lastSyncedSearch.current = "";
    setSearchDraft("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  };

  return (
    <aside className="flex w-full flex-col gap-5 lg:w-56 lg:shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Filters</h2>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-6 px-1.5 text-xs text-muted-foreground"
          >
            <X className="size-3" />
            Clear
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search"
          aria-label="Search products"
          className="h-8 pr-7 pl-7 text-sm"
        />
        {searchDraft && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              apply({ search: "" });
            }}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-category" className="text-xs text-muted-foreground">
          Category
        </Label>
        <Select
          value={category}
          onValueChange={(value) => apply({ category: value })}
        >
          <SelectTrigger id="filter-category" size="sm" className="w-full">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.slug}>
                {c.name}
                {/* the count is the ACTIVE product count, so it is the number of results the
                    shopper gets if they pick it from here with no other filter applied */}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {c.productCount}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-sort" className="text-xs text-muted-foreground">
          Sort by
        </Label>
        <Select value={sort} onValueChange={(value) => apply({ sort: value })}>
          <SelectTrigger id="filter-sort" size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="filter-instock" className="text-xs text-muted-foreground">
            In stock only
          </Label>
          <Switch
            id="filter-instock"
            checked={inStock}
            onCheckedChange={(checked) => apply({ inStock: checked ? "true" : null })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="filter-discounted" className="text-xs text-muted-foreground">
            Discounted only
          </Label>
          <Switch
            id="filter-discounted"
            checked={discounted}
            onCheckedChange={(checked) => apply({ discounted: checked ? "true" : null })}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {isPending && <Spinner className="size-3" />}
        <span className="tabular-nums">
          {total} {total === 1 ? "product" : "products"}
        </span>
      </div>
    </aside>
  );
}