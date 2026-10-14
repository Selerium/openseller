"use client";

import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import ProductCard, { type ProductCardData } from "@/components/storefront/productCard";
import type { CategorySummary, Paged } from "@/components/storefront/types";
import { cn } from "@/lib/utils";
import {
  count,
  productSort,
  readButtons,
  readContactInputs,
  readStringList,
  text,
  safeHref,
} from "./fields";
import type { ElementRenderProps } from "./registry";

/**
 * The storefront body of every element preset.
 *
 * These are what the storefront sees after a publish: RenderLayout looks the kind up in the
 * registry and hands it the stored `fields`, and nothing else in the pipeline knows what a
 * "hero" or a "products grid" is. Two rules hold for all of them:
 *
 *   - **Empty means absent.** A preset whose fields are all blank returns null rather than
 *     an empty box, so a section of untouched defaults reads as a gap in the page instead of
 *     a bordered hole in it.
 *   - **Reads go through fields.ts.** The form and the renderer agree on every value by
 *     sharing one reader; a document from an older editor renders as its blanks.
 *
 * The two data presets (products, categories) fetch their own catalog on mount, like every
 * other storefront surface does — the homepage carries a tree, not a copy of the catalog.
 */

// --- hero -----------------------------------------------------------------

export function HeroRender({ fields }: ElementRenderProps) {
  const heading = text(fields.heading).trim();
  const subtext = text(fields.subtext).trim();
  const imageUrl = text(fields.imageUrl).trim();
  const imageAlt = text(fields.imageAlt);
  const buttonLabel = text(fields.buttonLabel).trim();
  const href = safeHref(fields.buttonHref);

  if (!heading && !subtext && !imageUrl && !buttonLabel) return null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      {imageUrl && (
        <img
          src={imageUrl}
          alt={imageAlt}
          loading="lazy"
          className="aspect-[16/6] w-full object-cover"
        />
      )}
      <div className="space-y-3 p-5 md:p-6">
        {heading && (
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{heading}</h2>
        )}
        {subtext && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground md:text-base">
            {subtext}
          </p>
        )}
        {buttonLabel && href && (
          <Button size="lg" asChild>
            <Link href={href}>{buttonLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

// --- heading ---------------------------------------------------------------

export function HeadingRender({ fields }: ElementRenderProps) {
  const title = text(fields.title).trim();
  const body = text(fields.body).trim();

  if (!title && !body) return null;

  return (
    <div className="space-y-2">
      {title && <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>}
      {body && <p className="whitespace-pre-line leading-relaxed text-muted-foreground">{body}</p>}
    </div>
  );
}

// --- image -----------------------------------------------------------------

export function ImageRender({ fields }: ElementRenderProps) {
  const images = readStringList(fields.images).filter((url) => url.trim() !== "");
  const caption = text(fields.caption).trim();

  if (images.length === 0) return null;

  // One description covers the set. Repeating identical alt text on every tile would make a
  // screen reader read the same sentence N times, and the caption below names the group.
  const alt = text(fields.alt);

  if (images.length === 1) {
    return (
      <figure className="space-y-2">
        <img
          src={images[0]}
          alt={alt}
          loading="lazy"
          className="max-h-[420px] w-full rounded-lg border object-cover"
        />
        {caption && <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>}
      </figure>
    );
  }

  return (
    <figure className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {images.map((url, index) => (
          <img
            key={`${index}-${url}`}
            src={url}
            alt={index === 0 ? alt : ""}
            loading="lazy"
            className={cn(
              "h-40 w-full rounded-lg border object-cover md:h-52",
              // An odd last tile spans the row rather than leaving half a grid empty.
              images.length % 2 === 1 && index === images.length - 1 && "col-span-2",
            )}
          />
        ))}
      </div>
      {caption && <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

// --- button ----------------------------------------------------------------

export function ButtonRender({ fields }: ElementRenderProps) {
  // Blank labels and unusable links are dropped here rather than rendered as inert controls:
  // a button a visitor can click that goes nowhere is worse than no button.
  const buttons = readButtons(fields.buttons).flatMap((button) => {
    const href = safeHref(button.href);
    const label = button.label.trim();
    return label && href ? [{ label, href }] : [];
  });

  if (buttons.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {buttons.map((button, index) => (
        <Button
          key={`${button.href}-${button.label}`}
          size="lg"
          // The first call to action carries the page's primary colour; the rest are outlined
          // so a row of three does not read as three equally important destinations.
          variant={index === 0 ? "default" : "outline"}
          asChild
        >
          <Link href={button.href}>{button.label}</Link>
        </Button>
      ))}
    </div>
  );
}

// --- products --------------------------------------------------------------

export function ProductsRender({ fields }: ElementRenderProps) {
  const title = text(fields.title).trim();
  const sort = productSort(fields.source);
  const limit = count(fields.limit, 8, 1, 12);

  const [items, setItems] = useState<ProductCardData[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setFailed(false);

    void (async () => {
      try {
        const res = await api<Paged<ProductCardData>>(
          `/products?sort=${sort}&perPage=${limit}`,
        );
        if (!cancelled) setItems(res.data.items ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sort, limit]);

  return (
    <div className="space-y-4">
      {title && <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>}

      {failed && <EmptyNote>Products could not be loaded right now.</EmptyNote>}

      {items === null && !failed && <ProductGridSkeleton />}

      {items !== null && items.length === 0 && (
        <EmptyNote>No products to show yet.</EmptyNote>
      )}

      {items !== null && items.length > 0 && (
        // Same border-sharing grid as the marketplace: the container owns the top and left
        // rules and each cell its right and bottom, so no line is drawn twice.
        <div className="grid grid-cols-2 border-t border-l border-border sm:grid-cols-3">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The muted line a data preset shows for an empty or unreachable catalog. */
function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** Skeletons shaped like the grid they stand in for, so the page does not jump when data lands. */
function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 border-t border-l border-border sm:grid-cols-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="border-r border-b border-border p-3">
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

// --- categories ------------------------------------------------------------

export function CategoriesRender({ fields }: ElementRenderProps) {
  const title = text(fields.title).trim();
  const limit = count(fields.limit, 8, 1, 12);

  const [categories, setCategories] = useState<CategorySummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await api<CategorySummary[]>("/categories");
        if (!cancelled) setCategories(res.data ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const shown = (categories ?? []).slice(0, limit);

  return (
    <div className="space-y-4">
      {title && <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>}

      {failed && <EmptyNote>Categories could not be loaded right now.</EmptyNote>}

      {categories === null && !failed && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-lg" />
          ))}
        </div>
      )}

      {categories !== null && categories.length === 0 && <EmptyNote>No categories yet.</EmptyNote>}

      {shown.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((category) => (
            <Link
              key={category.id}
              href={`/marketplace?category=${encodeURIComponent(category.slug)}`}
              className="rounded-lg border bg-card p-4 shadow-xs transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <span className="block truncate text-sm font-medium">{category.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {category.productCount} {category.productCount === 1 ? "product" : "products"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// --- contact form ----------------------------------------------------------

/**
 * The contact form, submitted through the visitor's own mail client.
 *
 * There is no message store behind this element — the API has no contact endpoint and the
 * homepage document is not a place to keep a visitor's inbox — so the submit composes a
 * `mailto:` addressed to the destination the admin configured in the element's editor. The
 * message really is sent; nothing silently disappears into a void that does not exist.
 *
 * Until an address is set the button is replaced by a line saying sending is unavailable:
 * a submit that goes nowhere is the one affordance this element must not show.
 */
export function ContactFormRender({ fields }: ElementRenderProps) {
  const title = text(fields.title).trim();
  const intro = text(fields.intro).trim();
  const to = text(fields.to).trim();
  const submitLabel = text(fields.submitLabel).trim() || "Send message";
  const inputs = readContactInputs(fields.inputs);

  const formId = useId();
  const [values, setValues] = useState<Record<number, string>>({});

  if (!title && !intro && inputs.length === 0) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const body = inputs
      .map((input, index) => `${input.label || `Field ${index + 1}`}: ${values[index] ?? ""}`)
      .join("\n");

    const subject = encodeURIComponent(title || "Message from the storefront");
    window.location.href = `mailto:${to}?subject=${subject}&body=${encodeURIComponent(body)}`;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {title && <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>}
      {intro && <p className="whitespace-pre-line text-sm text-muted-foreground">{intro}</p>}

      {inputs.map((input, index) => {
        const id = `${formId}-${index}`;
        const label = input.label || `Field ${index + 1}`;
        const value = values[index] ?? "";
        const setValue = (next: string) => setValues((current) => ({ ...current, [index]: next }));

        return (
          <div key={index} className="space-y-2">
            <Label htmlFor={id}>
              {label}
              {input.required && (
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              )}
            </Label>
            {input.type === "textarea" ? (
              <Textarea
                id={id}
                rows={4}
                required={input.required}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <Input
                id={id}
                type={input.type}
                required={input.required}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </div>
        );
      })}

      {to ? (
        <Button type="submit" size="lg">
          {submitLabel}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          This form is not accepting messages yet — please check back later.
        </p>
      )}
    </form>
  );
}
