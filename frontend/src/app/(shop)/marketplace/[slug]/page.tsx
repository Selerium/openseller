"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, PackageX, ShoppingBag } from "lucide-react";
import { api } from "@/lib/api";
import { useCart } from "@/lib/cart-context";
import { formatMoney } from "@/lib/money";
import { formatCount, formatReviews } from "@/lib/format";
import { Rating } from "@/components/ui/rating";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import QuantityStepper from "@/components/storefront/quantityStepper";
import type { Paged, ProductDetail, Review } from "@/components/storefront/types";
import Container from "@/components/layout/container";

/**
 * Product detail.
 *
 * The variant picker and quantity stepper clamp to the selected variant's stock, so the quantity
 * handed to the cart is already within what can be bought.
 */
export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { add } = useCart();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [reviews, setReviews] = useState<Paged<Review> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);

  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const detail = await api<ProductDetail>(`/products/${slug}`);
      setProduct(detail.data);

      // Reviews are a separate paginated endpoint, so they load alongside rather than blocking
      // the product body. A product with no reviews returns an empty page, not an error.
      const listed = await api<Paged<Review>>(`/products/${slug}/reviews?perPage=5`);
      setReviews(listed.data);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError({
        message: err instanceof Error ? err.message : "Could not load this product",
        notFound: status === 404,
      });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  // Preselect the first variant that can actually be bought. Preselecting the first variant
  // outright would land a shopper on an out-of-stock option — the Ultralight 2P Tent is
  // Medium/Large with Large at zero stock, so this is a real case, not a hypothetical one.
  useEffect(() => {
    if (!product) return;
    const preferred =
      product.variants.find((v) => v.inStock) ?? product.variants[0] ?? null;
    setVariantId(preferred?.id ?? null);
    setQuantity(1);
  }, [product]);

  const selected = product?.variants.find((v) => v.id === variantId) ?? null;

  // Clamp rather than trust: the variant can go out of stock between render and click, and a
  // stepper showing 5 against a stock of 2 is an order that cannot be placed.
  const maxQuantity = selected?.quantity ?? 0;
  const quantityForDisplay = Math.min(quantity, Math.max(maxQuantity, 1));

  const handleAdd = useCallback(() => {
    if (!product || !selected || selected.quantity < 1) return;

    add({
      variantId: selected.id,
      productId: product.id,
      slug: product.slug,
      title: product.title,
      // A simple product's only variant is called "Default"; printing that on a cart line tells
      // the shopper nothing they did not already know from there being one option.
      variantName: product.variants.length > 1 ? selected.name : "",
      image: product.images[0]?.url ?? null,
      currency: product.currency,
      unitPriceCents: selected.priceCents,
      quantity: quantityForDisplay,
      maxQuantity: selected.quantity,
    });

    toast.success("Added to cart", {
      description:
        quantityForDisplay > 1
          ? `${quantityForDisplay} × ${product.title}`
          : product.title,
      action: {
        label: "View cart",
        onClick: () => router.push("/cart"),
      },
    });
  }, [add, product, selected, quantityForDisplay]);

  if (loading) {
    return (
      <Container className="py-6">
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="mt-4 h-9 w-32" />
            <Skeleton className="mt-6 h-11 w-full max-w-xs" />
          </div>
        </div>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="flex flex-col items-center gap-3 py-24 text-center">
        <PackageX className="size-8 text-muted-foreground" />
        <p className="font-medium">
          {error.notFound ? "Product not found" : "Could not load this product"}
        </p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button variant="outline" size="sm" asChild className="mt-2">
          <Link href="/marketplace">Back to marketplace</Link>
        </Button>
      </Container>
    );
  }

  if (!product) return null;

  const discounted = product.discountPercent > 0 && product.listPriceCents !== null;
  const soldOut = !selected?.inStock;

  return (
    <Container className="py-6">
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex items-center gap-1 text-sm text-muted-foreground"
      >
        <Link href="/marketplace" className="hover:text-foreground">
          Marketplace
        </Link>
        {product.category && (
          <>
            <ChevronRight className="size-3.5" />
            <Link
              href={`/marketplace?category=${product.category.slug}`}
              className="hover:text-foreground"
            >
              {product.category.name}
            </Link>
          </>
        )}
        <ChevronRight className="size-3.5" />
        <span className="truncate text-foreground">{product.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* gallery */}
        <div className="flex flex-col gap-3">
          <div className="aspect-square overflow-hidden rounded-lg bg-muted">
            {product.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.images[0].url}
                alt={product.images[0].alt ?? product.title}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                No image
              </div>
            )}
          </div>

          {/* thumbnails only when there is more than one image, so a single-image product does
              not get a redundant strip of one */}
          {product.images.length > 1 && (
            <div className="flex gap-2">
              {product.images.map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image.id}
                  src={image.url}
                  alt={image.alt ?? ""}
                  className="size-16 rounded-md border border-border object-cover"
                />
              ))}
            </div>
          )}
        </div>

        {/* buy column */}
        <div className="flex flex-col">
          {product.category && (
            <Link
              href={`/marketplace?category=${product.category.slug}`}
              className="text-xs text-muted-foreground hover:text-underline"
            >
              {product.category.name}
            </Link>
          )}

          <h1 className="mt-1 font-heading text-2xl font-medium">{product.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{product.brief}</p>

          <div className="mt-3 flex items-center gap-2 text-sm">
            {product.ratingCount > 0 ? (
              <>
                <Rating value={product.ratingAvg} size="md" />
                <span className="font-medium tabular-nums">
                  {product.ratingAvg.toFixed(1)}
                </span>
                <span className="text-muted-foreground">
                  ({formatCount(product.ratingCount)})
                </span>
                <span className="sr-only">
                  {formatReviews(product.ratingCount)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No reviews yet</span>
            )}
          </div>

          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {formatMoney(
                selected ? selected.priceCents : product.priceCents,
                product.currency
              )}
            </span>
            {discounted && product.listPriceCents !== null && (
              <>
                <span className="text-base text-muted-foreground line-through tabular-nums">
                  {formatMoney(product.listPriceCents, product.currency)}
                </span>
                <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                  -{product.discountPercent}%
                </Badge>
              </>
            )}
            {product.priceFrom && (
              <span className="text-sm text-muted-foreground">from</span>
            )}
          </div>

          {/* variant picker. A simple product has exactly one variant named "Default", so the
              control is hidden rather than rendered as a single dead option. */}
          {product.variants.length > 1 && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium">Options</p>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((variant) => {
                  const active = variant.id === variantId;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => {
                        setVariantId(variant.id);
                        setQuantity(1);
                      }}
                      aria-pressed={active}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : variant.inStock
                            ? "border-border hover:border-foreground/40"
                            : "border-border text-muted-foreground line-through opacity-60"
                      }`}
                    >
                      {variant.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <QuantityStepper
              value={quantity}
              max={maxQuantity}
              onChange={setQuantity}
              disabled={soldOut}
            />

            {soldOut ? (
              <Badge variant="secondary" className="h-9 px-3">
                Out of stock
              </Badge>
            ) : (
              <Button size="lg" className="min-w-40" onClick={handleAdd}>
                <ShoppingBag className="size-4" />
                Add to cart
              </Button>
            )}
          </div>

          {selected && (
            <p className="mt-3 text-xs text-muted-foreground tabular-nums">
              {selected.quantity} available
            </p>
          )}

          <Separator className="my-6" />

          <div>
            <h2 className="mb-2 font-heading text-sm font-medium">Description</h2>
            <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
              {product.description}
            </p>
          </div>
        </div>
      </div>

      {/* reviews */}
      <section className="mt-12 max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-medium">Reviews</h2>
          {reviews && reviews.total > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatReviews(reviews.total)}
            </span>
          )}
        </div>

        {reviews && reviews.total === 0 && (
          <p className="text-sm text-muted-foreground">
            No reviews yet. Be the first once you have bought this.
          </p>
        )}

        {reviews && reviews.items.length > 0 && (
          <ul className="flex flex-col">
            {reviews.items.map((review) => (
              <li
                key={review.id}
                className="flex flex-col gap-1.5 border-t border-border py-4"
              >
                <div className="flex items-center gap-2">
                  <Rating value={review.rating} />
                  <span className="text-sm font-medium">{review.authorName}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(review.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                {review.title && <p className="text-sm font-medium">{review.title}</p>}
                {review.body && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {review.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {reviews && reviews.total > reviews.items.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {reviews.items.length} of {reviews.total}. Full review list arrives with the
            reviews write path in Phase 10.
          </p>
        )}
      </section>

      <div className="mt-12">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/marketplace">
            <ArrowLeft className="size-3.5" />
            Back to marketplace
          </Link>
        </Button>
      </div>
    </Container>
  );
}