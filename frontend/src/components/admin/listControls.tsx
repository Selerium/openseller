"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Sentinel for the "no filter" select option. An empty string is not a legal value for the
 * underlying select, so "All" carries a value of its own that never reaches the URL — the
 * param for it is deleted instead (mirrors ALL_CATEGORIES in storefront/filterSidebar).
 */
const ALL_VALUES = "__all__";

/**
 * Search box that writes a URL param a beat after typing stops.
 *
 * The draft text lives here rather than in the URL so each keystroke is not fought by the
 * router; the URL catches up 300ms later, and is only read back when it changes from the
 * outside (back button, Clear, a shared link).
 */
export function ListSearchInput({
  value,
  onApply,
  label,
  placeholder,
  className,
}: {
  /** The param's current value — "" when absent. */
  value: string;
  /** Receives the debounced text, e.g. `(v) => apply({ search: v })`. */
  onApply: (value: string) => void;
  /** Accessible name for the field. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const lastSynced = useRef(value);

  // Held in a ref so an inline arrow from the caller cannot restart the debounce timer on
  // every parent render — only what the user types should.
  const onApplyRef = useRef(onApply);
  useEffect(() => {
    onApplyRef.current = onApply;
  });

  // Sync back from the URL only when it changed without us (back button, Clear, shared link);
  // otherwise the router would rewrite the field mid-word.
  useEffect(() => {
    if (value !== lastSynced.current) {
      lastSynced.current = value;
      setDraft(value);
    }
  }, [value]);

  // Debounced so a search does not fire a request per keystroke. 300ms is long enough to skip
  // most intermediate states and short enough that the list feels like it is responding.
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => {
      lastSynced.current = draft;
      onApplyRef.current(draft);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 pr-7 pl-7 text-sm"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            lastSynced.current = "";
            setDraft("");
            onApplyRef.current("");
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export interface ListFilterOption {
  value: string;
  label: string;
}

/**
 * One dropdown filter whose selection lives in a URL param.
 *
 * `value` is the param's raw value ("" when unset) and `onChange` receives null when the
 * param should be deleted, so a page can pass it straight through to `apply`.
 */
export function ListFilterSelect({
  value,
  options,
  onChange,
  allLabel,
  label,
  className,
}: {
  /** The param's current value — "" when unset. */
  value: string;
  /** Options; `value` is what the API accepts, `label` is how it reads. */
  options: ListFilterOption[];
  /** Receives the chosen value, or null when "All" was chosen. */
  onChange: (value: string | null) => void;
  /** Label for the "no filter" option, e.g. "All statuses". */
  allLabel: string;
  /** Accessible name for the field. */
  label: string;
  className?: string;
}) {
  return (
    <Select
      value={value === "" ? ALL_VALUES : value}
      onValueChange={(next) => onChange(next === ALL_VALUES ? null : next)}
    >
      <SelectTrigger aria-label={label} className={cn("w-auto", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUES}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Previous / "Page X of Y" / Next for a `Paged` envelope (backend/src/lib/http.ts pageOf).
 *
 * Hidden on a single-page result set, where it would be two disabled buttons carrying no
 * information. Real buttons rather than links because paging is a router.replace of the
 * current screen, not a navigation away from it.
 */
export function ListPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex items-center justify-center gap-1"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span className="px-3 text-sm text-muted-foreground tabular-nums">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
