"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackageOpen, ShoppingBag, Trash2, TriangleAlert } from "lucide-react";
import { useCart, type CartLine } from "@/lib/cart-context";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import QuantityStepper from "@/components/storefront/quantityStepper";
import { cn } from "@/lib/utils";
import Container from "@/components/layout/container";

/**
 * The cart.
 *
 * Re-reads the catalog on mount, because nothing in localStorage is a promise: the price may have
 * moved, the variant may have been deleted, the product may have been archived or sold out since
 * the line was added. `reconcile` folds the live figures back in and reports what changed, which is
 * then surfaced once as a toast rather than as a wall of per-line warnings.
 *
 * Totals are computed here rather than in the cart context, so the figures a shopper pays by are
 * the same figures the backend will re-derive in Phase 4. Shipping and tax are zero in v1 with the
 * fields reserved (see the plan); the rows are here so adding them later does not move the layout.
 */
export default function CartPage() {
  const router = useRouter();
  const {
    lines,
    issues,
    hydrated,
    add,
    setQuantity,
    remove,
    clear,
    reconcile,
  } = useCart();
  const [checking, setChecking] = useState(false);

  // reconcile() depends on `lines`, so it is a new function identity on every cart change. This
  // ref pins the version the mount effect actually checked, which is what lets the effect below
  // keep an empty dependency array instead of refetching the catalog on every quantity change.
  const checkedVersion = useRef(0);
  useEffect(() => {
    checkedVersion.current += 1;
  }, [lines]);

  useEffect(() => {
    if (!hydrated || lines.length === 0) return;

    let cancelled = false;
    const version = checkedVersion.current;

    setChecking(true);

    reconcile()
      .then((result) => {
        if (cancelled || checkedVersion.current !== version) return;

        // One summary rather than a toast per line: a cart with six repriced lines should not
        // bury the page under six notifications.
        const notes: string[] = [];
        if (result.unavailable.length > 0) {
          notes.push(
            `${result.unavailable.length} item${result.unavailable.length > 1 ? "s are" : " is"} no longer available`
          );
        }
        if (result.repriced.length > 0) {
          notes.push(
            `${result.repriced.length} price${result.repriced.length > 1 ? "s have" : " has"} changed`
          );
        }
        if (result.clamped.length > 0) {
          notes.push(
            `quantity reduced on ${result.clamped.length} item${result.clamped.length > 1 ? "s" : ""} to match stock`
          );
        }

        if (notes.length > 0) {
          toast("Cart updated", { description: notes.join("; ") + "." });
        }
      })
      .catch(() => {
        // A failed check is not a failed cart. The stored lines are still shown, with whatever
        // they last knew, and the backend re-prices at checkout regardless.
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const blocked = lines.filter((line) => line.variantId in issues);
  const payable = lines.filter((line) => !(line.variantId in issues));

  const subtotalCents = payable.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0
  );
  const currency = payable[0]?.currency ?? lines[0]?.currency ?? "usd";
  const canCheckout = payable.length > 0 && blocked.length === 0;

  const handleRemove = useCallback(
    (line: CartLine) => {
      remove(line.variantId);
      toast("Removed", {
        description: line.title,
        action: {
          label: "Undo",
          // The line is gone from storage, so undo re-adds rather than undeletes. It is exact:
          // every field the line carried is still in scope here, and `add` merges into an existing
          // line instead of duplicating one if the shopper re-added it in the meantime.
          onClick: () => add(line),
        },
      });
    },
    [add, remove]
  );

  /**
   * Hand off to the checkout page.
   *
   * This deliberately does *not* call POST /checkout/session. That endpoint requires an email
   * address and a full shipping address (`parseAddressInput` rejects the request outright without
   * one), and the cart holds neither. Collecting them inline would duplicate the address form
   * that /checkout already owns, so the cart's only job here is to route; /checkout creates the
   * session and follows the `redirectUrl` the backend hands back.
   */
  const createCheckout = () => {
    router.push("/checkout");
  };

  if (!hydrated) {
    return (
      <Container className="py-6">
        <Skeleton className="h-8 w-40" />
        <div className="mt-6 flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      </Container>
    );
  }

  if (lines.length === 0) {
    return (
      <Container className="flex flex-col items-center gap-3 py-24 text-center">
        <PackageOpen className="size-8 text-muted-foreground" />
        <h1 className="font-heading text-xl font-medium">Your cart is empty</h1>
        <p className="text-sm text-muted-foreground">
          Browse the marketplace and add something you like.
        </p>
        <Button className="mt-2" asChild>
          <Link href="/marketplace">
            <ShoppingBag className="size-4" />
            Browse the marketplace
          </Link>
        </Button>
      </Container>
    );
  }

  return (
    <Container className="py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium">Your cart</h1>
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear cart
        </Button>
      </div>

      {blocked.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              {blocked.length} item{blocked.length > 1 ? "s" : ""} cannot be checked out
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Remove {blocked.length > 1 ? "them" : "it"} to continue.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <ul className="flex flex-col">
          {lines.map((line) => {
            const issue = issues[line.variantId];
            const lineTotal = line.unitPriceCents * line.quantity;

            return (
              <li
                key={line.variantId}
                className={cn(
                  "flex gap-4 border-t border-border py-4",
                  issue && "opacity-60",
                )}
              >
                <Link
                  href={`/marketplace/${line.slug}`}
                  className="size-20 shrink-0 overflow-hidden rounded-md bg-muted"
                >
                  {line.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={line.image}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/marketplace/${line.slug}`}
                        className="line-clamp-1 text-sm font-medium hover:underline"
                      >
                        {line.title}
                      </Link>
                      {line.variantName && (
                        <p className="text-xs text-muted-foreground">{line.variantName}</p>
                      )}
                      {issue ? (
                        <Badge
                          variant="outline"
                          className="mt-1 border-amber-600/40 text-[0.65rem] text-amber-700 dark:text-amber-500"
                        >
                          {issue.reason}
                        </Badge>
                      ) : (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {formatMoney(line.unitPriceCents, line.currency)} each
                        </p>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(line)}
                      aria-label={`Remove ${line.title} from cart`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                    {issue ? (
                      <span className="text-xs text-muted-foreground">&mdash;</span>
                    ) : (
                      <QuantityStepper
                        value={line.quantity}
                        max={line.maxQuantity}
                        onChange={(next) => setQuantity(line.variantId, next)}
                      />
                    )}

                    <span className="text-sm font-medium tabular-nums">
                      {issue ? "—" : formatMoney(lineTotal, line.currency)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
          <li className="border-t border-border" />
        </ul>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-lg border border-border p-4">
            <h2 className="font-heading text-sm font-medium">Summary</h2>

            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Subtotal ({payable.length} item{payable.length === 1 ? "" : "s"})
                </dt>
                <dd className="tabular-nums">{formatMoney(subtotalCents, currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipping</dt>
                <dd className="text-muted-foreground">Calculated at checkout</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="text-muted-foreground">Calculated at checkout</dd>
              </div>
            </dl>

            <Separator className="my-3" />

            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(subtotalCents, currency)}</span>
            </div>

            <Button
              className="mt-4 w-full"
              size="lg"
              onClick={createCheckout}
              disabled={!canCheckout || checking}
            >
              {checking
                ? "Checking availability…"
                : blocked.length > 0
                  ? "Remove unavailable items"
                  : "Proceed to checkout"}
            </Button>

            {blocked.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                The total covers the {payable.length} item
                {payable.length === 1 ? "" : "s"} still available.
              </p>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              Prices and stock are confirmed again at checkout, and you are not charged until the
              payment step.
            </p>
          </div>
        </aside>
      </div>
    </Container>
  );
}