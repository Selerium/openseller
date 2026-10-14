"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "./api";
import {
  CART_STORAGE_KEY,
  addLine,
  parseCart,
  reconcileLines,
  setLineQuantity,
  type AddLineInput,
  type CartIssue,
  type CartLine,
} from "./cart-storage";
import type { ProductDetail } from "@/components/storefront/types";

/**
 * The cart.
 *
 * Entirely client-side, in localStorage, and deliberately not a backend resource: carts are
 * per-browser, a shopper must be able to fill one without an account, and nothing is reserved or
 * held until checkout. The first thing that becomes an `Order` is the Checkout Session in Phase 4,
 * at which point the backend re-prices from its own rows.
 *
 * Two consequences follow from holding no server copy, and both shape this file:
 *
 *   1. **Nothing in here is a source of truth.** The unit price and stock a line carries were
 *      correct when the shopper looked at them and may not be now. They exist so the cart renders
 *      without a round trip per line, and `reconcile` re-reads the catalog and overwrites them.
 *   2. **localStorage is user-writable and outlives deploys.** Every read goes through the
 *      defensive parsing in cart-storage.ts.
 *
 * The cart is keyed by `variantId`, not `productId`. A product can have several variants and a
 * shopper can legitimately want two different sizes, which would collapse into one line per
 * product if the key were the product.
 *
 * All the arithmetic lives in cart-storage.ts. This file is only React: state, persistence and the
 * one network call.
 */

export interface ReconcileResult {
  /** Distinct products re-read from the catalog. */
  checked: number;
  unavailable: string[];
  repriced: string[];
  clamped: string[];
}

interface CartContextValue {
  lines: CartLine[];
  /** Total units, not distinct lines. This is what the header badge counts. */
  count: number;
  /** False until localStorage has been read, so nothing renders a count it cannot yet know. */
  hydrated: boolean;
  issues: Record<string, CartIssue>;
  add: (input: AddLineInput) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  reconcile: () => Promise<ReconcileResult>;
  clearBlocked: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [issues, setIssues] = useState<Record<string, CartIssue>>({});
  const [hydrated, setHydrated] = useState(false);

  // Read after mount, never during render. Reading localStorage in the render body would produce
  // one markup on the server and a different one on the client, and React reports that as a
  // hydration error rather than quietly repairing it.
  useEffect(() => {
    setLines(parseCart(window.localStorage.getItem(CART_STORAGE_KEY)));
    setHydrated(true);
  }, []);

  // Gated on `hydrated` so the first pass cannot overwrite a stored cart with the empty array that
  // stands in for "not read yet".
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Private browsing or a full quota. The cart still works for this page view; it just will
      // not survive a reload, which beats taking the storefront down with it.
    }
  }, [lines, hydrated]);

  // Another tab changed the cart. This event only fires in *other* tabs, which is exactly the
  // scope wanted: reacting to our own writes would loop.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== CART_STORAGE_KEY) return;
      setLines(parseCart(event.newValue));
      setIssues({});
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback((input: AddLineInput) => {
    setLines((prev) => addLine(prev, input, Date.now()));

    // The line is buyable again, whatever the last reconcile concluded.
    setIssues((prev) => {
      if (!(input.variantId in prev)) return prev;
      const next = { ...prev };
      delete next[input.variantId];
      return next;
    });
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setLines((prev) => setLineQuantity(prev, variantId, quantity));
  }, []);

  const remove = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((line) => line.variantId !== variantId));
    setIssues((prev) => {
      if (!(variantId in prev)) return prev;
      const next = { ...prev };
      delete next[variantId];
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setIssues({});
  }, []);

  /**
   * Re-reads the catalog and folds what it finds back into the stored lines.
   *
   * Runs only when the cart page asks for it, never on mount of the provider, so browsing the
   * marketplace costs no extra requests. Each distinct product is fetched once by slug; a cart is a
   * handful of products, so the parallel fan-out is cheaper than adding a batch endpoint, and it
   * reuses the endpoint the detail page already calls.
   */
  const reconcile = useCallback(async (): Promise<ReconcileResult> => {
    const result: ReconcileResult = {
      checked: 0,
      unavailable: [],
      repriced: [],
      clamped: [],
    };

    const slugs = Array.from(new Set(lines.map((line) => line.slug)));
    if (slugs.length === 0) return result;
    result.checked = slugs.length;

    const details = await Promise.all(
      slugs.map(async (slug) => {
        try {
          const res = await api<ProductDetail>(`/products/${slug}`);
          return res.data;
        } catch {
          // Draft, archived or deleted products 404 on the public endpoint. That is the answer
          // wanted here, not an error to surface: an unbuyable line is exactly what is being looked
          // for.
          return null;
        }
      })
    );

    const gone = new Set<string>();
    const live = new Map<string, { priceCents: number; stock: number }>();

    slugs.forEach((slug, index) => {
      const detail = details[index];
      if (!detail) {
        gone.add(slug);
        return;
      }
      for (const variant of detail.variants) {
        live.set(variant.id, { priceCents: variant.priceCents, stock: variant.quantity });
      }
    });

    const reconciled = reconcileLines(lines, live, gone);

    // Reported from the *pre*-reconciliation lines: the new lines no longer carry the old price or
    // the too-high quantity that made them worth mentioning.
    for (const line of lines) {
      const current = live.get(line.variantId);

      if (line.variantId in reconciled.issues || !current) {
        result.unavailable.push(line.title);
        continue;
      }
      if (line.unitPriceCents !== current.priceCents) result.repriced.push(line.title);
      if (line.quantity > current.stock) result.clamped.push(line.title);
    }

    setLines(reconciled.lines);
    setIssues(reconciled.issues);
    return result;
  }, [lines]);

  const count = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines]
  );

  const clearBlocked = useCallback(() => setIssues({}), []);
  const value = useMemo(
    () => ({
      lines,
      count,
      hydrated,
      issues,
      add,
      setQuantity,
      remove,
      clear,
      reconcile,
      clearBlocked,
    }),
    [lines, count, hydrated, issues, add, setQuantity, remove, clear, reconcile, clearBlocked]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside a CartProvider");
  }
  return context;
}

export type { AddLineInput, CartIssue, CartLine };