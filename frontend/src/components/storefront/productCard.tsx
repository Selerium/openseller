"use client";

import Link from "next/link";
import { Rating } from "@/components/ui/rating";
import { Badge } from "@/components/ui/badge";
import QuickAddButton from "./quickAddButton";
import { formatMoney } from "@/lib/money";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  brief: string;
  image: string | null;
  priceCents: number;
  /** Pre-discount price, or null when the product is not discounted. */
  listPriceCents: number | null;
  discountPercent: number;
  priceFrom: boolean;
  currency: string;
  inStock: boolean;
  quantity: number;
  ratingAvg: number;
  ratingCount: number;
}

interface ProductCardProps {
  product: ProductCardData;
}

/**
 * Marketplace grid cell.
 *
 * Deliberately minimal: image, title, brief, price, rating.
 *
 * One link per cell, stretched over the whole thing rather than wrapping the image and title
 * separately — two links to one destination is a duplicated tab stop for keyboard and screen
 * reader users. That leaves nowhere to put a button *inside* an anchor without nesting one
 * interactive control inside another, which is invalid and confuses assistive technology, so the
 * cell is a plain div with the link laid over it (`z-10`) and the quick-add button above that
 * (`z-20`). One tab stop, one hit area, and a real button.
 */
export default function ProductCard({ product }: ProductCardProps) {
  const {
    id,
    slug,
    title,
    brief,
    image,
    priceCents,
    listPriceCents,
    discountPercent,
    priceFrom,
    currency,
    inStock,
    ratingAvg,
    ratingCount,
  } = product;

  const discounted = discountPercent > 0 && listPriceCents !== null;
  // A product with no reviews still shows the empty rating row: hiding it would make the grid
  // jump as rows load, and "no reviews yet" is honest information next to the price.
  const rated = ratingCount > 0;

  return (
    <div
      className={cn(
        // The grid container owns the top and left rules; each cell owns its right and bottom, so
        // the internal lines are shared rather than doubled.
        "group relative flex flex-col border-r border-b border-border bg-background p-3",
        "transition-colors hover:bg-muted/40",
        // out of stock is a whole-cell state, not a badge: the card desaturates so a sold-out
        // item cannot be mistaken for a live one at a glance across a dense grid
        !inStock && "bg-muted/20",
      )}
    >
      <div className="relative mb-3 aspect-square overflow-hidden rounded-md bg-muted">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            // the title is the accessible name for this link, so the image must stay empty
            // alt or the name becomes "photo of a mug Single Origin Ethiopia Yirgacheffe"
            className={cn(
              "size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]",
              !inStock && "opacity-60 saturate-50",
            )}
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            No image
          </div>
        )}

        {!inStock && (
          <Badge
            variant="secondary"
            className="absolute top-2 left-2 bg-background/90 text-[0.65rem] backdrop-blur-sm"
          >
            Out of stock
          </Badge>
        )}

        {discounted && (
          <Badge className="absolute top-2 right-2 bg-amber-600 text-[0.65rem] text-white hover:bg-amber-600">
            -{discountPercent}%
          </Badge>
        )}

        {/* Only while buyable. A sold-out card keeps its badge and nothing else, so the two
            states are not competing for the same corner. */}
        {inStock && (
          <QuickAddButton
            productId={id}
            slug={slug}
            title={title}
            image={image}
            currency={currency}
            simple={!priceFrom}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="line-clamp-1 text-sm font-medium">{title}</h3>
        <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">
          {brief}
        </p>

        <div className="mt-auto pt-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums">
              {formatMoney(priceCents, currency)}
            </span>
            {discounted && listPriceCents !== null && (
              <span className="text-xs text-muted-foreground line-through tabular-nums">
                {formatMoney(listPriceCents, currency)}
              </span>
            )}
            {/* "from" only means something when the price shown is the cheapest of several,
                otherwise every card would say "from" including single-variant ones */}
            {priceFrom && (
              <span className="text-[0.65rem] text-muted-foreground">from</span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {rated ? (
              <>
                <Rating value={ratingAvg} />
                <span className="tabular-nums">{ratingAvg.toFixed(1)}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums" title={`${ratingCount} reviews`}>
                  {formatCount(ratingCount)}
                </span>
                <span className="sr-only">
                  {ratingAvg.toFixed(1)} out of 5 from {ratingCount} reviews
                </span>
              </>
            ) : (
              <span className="text-muted-foreground/60">No reviews yet</span>
            )}
          </div>
        </div>
      </div>

      {/* Laid over the cell and after the content, so it covers the visual area while staying one
          focusable link. Inset focus ring: an outline drawn outside the cell would be clipped by
          the grid's own border rules. */}
      <Link
        href={`/marketplace/${slug}`}
        className="absolute inset-0 z-10 rounded-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span className="sr-only">{title}</span>
      </Link>
    </div>
  );
}