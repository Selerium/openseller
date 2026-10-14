"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Paged } from "@/components/storefront/types";

/** Matches DEFAULT_PER_PAGE in backend/src/lib/http.ts so both ends agree without a round trip. */
const PER_PAGE = 24;

export interface PagedList<T> {
  /** The current URL params, for reading individual filter values back out. */
  params: URLSearchParams;
  /** Latest page envelope, or null until the first response lands. */
  result: Paged<T> | null;
  loading: boolean;
  error: string | null;
  /** 1-based page from the URL, parsed and clamped the way the backend clamps it. */
  page: number;
  /** Patch filter params into the URL. Always drops `page`, and an empty/null value deletes. */
  apply: (patch: Record<string, string | null>) => void;
  /** Move to another page, keeping every other param as-is. */
  goToPage: (page: number) => void;
  /** Re-run the current query, e.g. from an error card's "Try again". */
  reload: () => void;
}

/**
 * URL-driven list state for a screen backed by one of the paginated list endpoints.
 *
 * The address bar is the source of truth for filters and page rather than component state,
 * because that is what makes a filtered view shareable, a refresh land on the same results,
 * and the back button step through filter history — all with the same `?page` / `?search` /
 * `?status` vocabulary the endpoint already documents (see backend/src/lib/http.ts).
 *
 * The API query is just the current params plus `perPage`, so a screen only has to pass its
 * endpoint path; which filters exist and how they render stays in the page file.
 *
 * Used by the admin products and orders screens. The storefront marketplace predates it and
 * keeps its own copy of this logic alongside its filter sidebar.
 */
export function usePagedList<T>(path: string): PagedList<T> {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const query = params.toString();
  const [result, setResult] = useState<Paged<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters can change faster than the API answers — typing through a debounced search still
  // produces back-to-back requests — so responses can land out of order. Only the newest
  // request may write state; a slow stale answer must never overwrite fresher results.
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<Paged<T>>(
        `${path}?${query}${query ? "&" : ""}perPage=${PER_PAGE}`
      );
      if (id !== request.current) return;
      setResult(res.data);
    } catch (err) {
      if (id !== request.current) return;
      setError(err instanceof Error ? err.message : "Could not load results");
    } finally {
      // A superseded request leaves the flag alone: the request that replaced it owns
      // loading now, and clearing it here would blank the list it is about to fill.
      if (id === request.current) setLoading(false);
    }
  }, [path, query]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every filter change resets to page 1.
   *
   * Without this, narrowing the set while on page 4 lands the user on a page that no longer
   * exists: the new result set may have two pages, and the screen would render "no results"
   * for a list that has plenty.
   */
  const apply = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());

      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }

      next.delete("page");

      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );

  const goToPage = useCallback(
    (target: number) => {
      const next = new URLSearchParams(params.toString());
      // page=1 is the default, so it is left out of the URL rather than pinned to it: a clean
      // link and a ?page=1 link should not be two different bookmarks.
      if (target <= 1) next.delete("page");
      else next.set("page", String(target));

      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );

  // parseInt rather than Number so "abc" becomes NaN and falls back to 1 instead of rendering
  // a page the backend will never return. Math.max mirrors parsePage's floor of 1.
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  return { params, result, loading, error, page, apply, goToPage, reload: load };
}
