"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShoppingBag } from "lucide-react";
import { api } from "@/lib/api";
import { useCart } from "@/lib/cart-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ProductDetail } from "./types";

interface QuickAddButtonProps {
  productId: string;
  slug: string;
  title: string;
  image: string | null;
  currency: string;
  /** One variant means the choice is already made, so the click can add without asking. */
  simple: boolean;
}

/**
 * Quick add from a marketplace card.
 *
 * The grid endpoint returns card shape, which has no variant ids — a card genuinely cannot name
 * the thing it would add. So this fetches the product on click, once, on an explicit user action.
 * That is cheaper than adding a batch endpoint to the catalog for a request only a click makes.
 *
 * A multi-variant product navigates to its page instead of guessing. Adding "the cheapest one"
 * would put something in the cart the shopper never chose, and the cart is keyed by variant, so
 * silently swapping it later is not possible either.
 */
export default function QuickAddButton({
  productId,
  slug,
  title,
  image,
  currency,
  simple,
}: QuickAddButtonProps) {
  const { add } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);

    try {
      const detail = (await api<ProductDetail>(`/products/${slug}`)).data;

      const variant = detail.variants.find((v) => v.quantity > 0) ?? null;

      // The grid's idea of this product can be a moment behind the detail endpoint, so re-check
      // rather than trust the card. Landing on the page that can express the choice beats picking
      // for the shopper, and covers the case where nothing is buyable at all.
      if (!simple || detail.variants.length > 1 || !variant) {
        router.push(`/marketplace/${slug}`);
        return;
      }

      add({
        variantId: variant.id,
        productId: detail.id,
        slug: detail.slug,
        title: detail.title,
        variantName: "",
        image: detail.images[0]?.url ?? image,
        currency: detail.currency || currency,
        unitPriceCents: variant.priceCents,
        quantity: 1,
        maxQuantity: variant.quantity,
      });

      toast.success("Added to cart", {
        description: title,
        action: { label: "View cart", onClick: () => router.push("/cart") },
      });
    } catch {
      toast.error("Could not add to cart", {
        description: "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      // Above the card's stretched link (z-10) so the click lands here rather than navigating.
      className="absolute right-2 bottom-2 z-20 rounded-full shadow-sm"
      disabled={busy}
      onClick={handleClick}
    >
      {busy ? <Spinner className="size-3.5" /> : <ShoppingBag className="size-3.5" />}
      <span className="sr-only">
        {simple ? `Add ${title} to cart` : `Choose options for ${title}`}
      </span>
    </Button>
  );
}