"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Cart link with a unit-count badge.
 *
 * Nothing renders until `hydrated`, because the count lives in localStorage and is unknowable
 * during the server render. Rendering it as 0 and correcting after mount would show every shopper
 * a "cart is empty" badge that was never true.
 *
 * The badge caps at 99+ so a large cart cannot push the header layout around.
 */
export default function CartButton({ className }: { className?: string }) {
  const { count, hydrated } = useCart();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("relative rounded-full", className)}
      asChild
    >
      <Link href="/cart">
        <ShoppingBag className="size-4" />
        {hydrated && count > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[0.6rem] font-semibold text-primary-foreground tabular-nums"
            aria-hidden="true"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
        <span className="sr-only">
          {hydrated && count > 0 ? `Cart, ${count} items` : "Cart, empty"}
        </span>
      </Link>
    </Button>
  );
}