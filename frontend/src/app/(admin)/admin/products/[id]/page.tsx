"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Rating } from "@/components/ui/rating";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Container from "@/components/layout/container";

interface AdminProduct {
  id: string;
  slug: string;
  title: string;
  brief: string;
  description: string;
  status: string;
  category: { id: string; name: string; slug: string } | null;
  currency: string;
  images: Array<{ id: string; url: string; alt: string | null; position: number }>;
  variants: Array<{
    id: string;
    name: string;
    sku: string;
    priceCents: number;
    stock: number;
    position: number;
  }>;
  priceCents: number;
  minPriceCents: number;
  discountPercent: number;
  stockTotal: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface DetailsForm {
  title: string;
  slug: string;
  brief: string;
  description: string;
  /** "" means no category — the same thing the API writes as null. */
  categoryId: string;
  discountPercent: string;
}

/** ProductStatus in backend/prisma/schema.prisma, with what each one means to a shopper. */
const STATUSES = [
  {
    value: "DRAFT",
    label: "Draft",
    hint: "Not visible in the marketplace. Work on it here until it is ready.",
  },
  {
    value: "ACTIVE",
    label: "Active",
    hint: "Listed in the marketplace and available to buy.",
  },
  {
    value: "ARCHIVED",
    label: "Archived",
    hint: "Hidden from the marketplace, but kept for order history and returns.",
  },
] as const;

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUSES.map((option) => [option.value, option.label]),
);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Stock and price cross the wire as strings so an input can hold "" mid-edit. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formFrom(product: AdminProduct): DetailsForm {
  return {
    title: product.title,
    slug: product.slug,
    brief: product.brief,
    description: product.description,
    categoryId: product.category?.id ?? "",
    discountPercent: String(product.discountPercent),
  };
}

function draftFrom(
  product: AdminProduct,
): Record<string, { stock: string; price: string }> {
  return Object.fromEntries(
    product.variants.map((variant) => [
      variant.id,
      { stock: String(variant.stock), price: centsToInput(variant.priceCents) },
    ]),
  );
}

/**
 * The product editor.
 *
 * Three independent writes rather than one giant save: details, stock and status each hit
 * their own endpoint, so an admin who counted a shelf does not have to re-check a paragraph of
 * marketing copy before a stock number lands, and a refused slug cannot hold a stock update
 * hostage. Every block says whether it has unsaved changes, and only its own Save button is
 * ever enabled for it.
 */
function EditProductPage() {
  const params = useParams();
  // The route is /admin/products/[id]. Cards link by id rather than slug because a slug is
  // editable — a slug in the URL goes stale the moment someone rewrites one.
  const productId = params.id as string;

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState<DetailsForm | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [variantDraft, setVariantDraft] = useState<
    Record<string, { stock: string; price: string }>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingStock, setSavingStock] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const load = useCallback(async () => {
    const res = await api<AdminProduct>(`/admin/products/${productId}`);
    setProduct(res.data);
    setForm(formFrom(res.data));
    setVariantDraft(draftFrom(res.data));
    setErrors({});
  }, [productId]);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;

    const run = async () => {
      try {
        await load();
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Could not load this product",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [load, productId]);

  // Categories are read-only reference data for this screen, and the select still has its
  // "no category" option without them, so a failure here degrades instead of blocking.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<Category[]>("/categories");
        if (!cancelled) setCategories(res.data);
      } catch {
        /* keep whatever options we already have */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The current category is included even if the list call failed: a select that silently
   * drops the value it is supposed to be showing reads as "this product has no category".
   */
  const categoryOptions = useMemo(() => {
    const current = product?.category;
    if (!current) return categories;
    return categories.some((category) => category.id === current.id)
      ? categories
      : [current, ...categories];
  }, [categories, product?.category]);

  const setField = (field: keyof DetailsForm, value: string) =>
    setForm((current) => (current ? { ...current, [field]: value } : current));

  const detailsDirty = useMemo(() => {
    if (!product || !form) return false;
    return (
      form.title !== product.title ||
      form.slug !== product.slug ||
      form.brief !== product.brief ||
      form.description !== product.description ||
      form.categoryId !== (product.category?.id ?? "") ||
      form.discountPercent !== String(product.discountPercent)
    );
  }, [product, form]);

  /**
   * Compared after parsing, exactly the way saveStock compares them before sending: "89" and
   * "89.00" are the same price, and a draft that only differs in formatting must not light up
   * a Save button whose press would then find nothing to write.
   */
  const changedVariants = useMemo(() => {
    if (!product) return [];
    return product.variants.filter((variant) => {
      const draft = variantDraft[variant.id];
      if (!draft) return false;
      return (
        Number(draft.stock) !== variant.stock ||
        Math.round(Number(draft.price) * 100) !== variant.priceCents
      );
    });
  }, [product, variantDraft]);

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!product || !form) return;

    // Checked here as well as on the server so the admin is told what is wrong while the
    // cursor is still in the field, rather than by a round trip that changed nothing.
    if (!form.title.trim()) return toast.error("Title is required");
    if (!form.slug.trim() || !SLUG_PATTERN.test(form.slug.trim())) {
      return toast.error(
        "Slug must be lowercase letters, numbers and single dashes",
      );
    }
    const discount = Number(form.discountPercent);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      return toast.error("Discount must be a number between 0 and 100");
    }

    setSavingDetails(true);
    try {
      const res = await api<AdminProduct>(`/admin/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.title.trim(),
          slug: form.slug.trim(),
          brief: form.brief,
          description: form.description,
          categoryId: form.categoryId,
          discountPercent: discount,
        }),
      });
      setProduct(res.data);
      setForm(formFrom(res.data));
      toast.success(res.message || "Product updated");
    } catch (err: unknown) {
      // The message is the useful part — "That slug is already in use" tells the admin what
      // to change, and the form keeps every keystroke so nothing has to be retyped.
      toast.error(err instanceof Error ? err.message : "Could not save this product");
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveStock() {
    if (!product) return;

    const nextErrors: Record<string, string> = {};
    const updates = product.variants.flatMap((variant) => {
      const draft = variantDraft[variant.id];
      if (!draft) return [];

      // Validated against the text rather than through Number(): "1.005" and "abc" are both
      // things a person can type, and parsing first would have to guess what they meant.
      if (!/^\d+$/.test(draft.stock.trim())) {
        nextErrors[`${variant.id}.stock`] = "Whole number, 0 or more";
      }
      if (!/^\d+(\.\d{1,2})?$/.test(draft.price.trim())) {
        nextErrors[`${variant.id}.price`] = "0 or more, at most 2 decimals";
      }

      return [
        {
          id: variant.id,
          stock: Number(draft.stock),
          priceCents: Math.round(Number(draft.price) * 100),
        },
      ];
    });

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Fix the highlighted rows before saving");
      return;
    }

    // Only rows that actually moved are sent, so the server's "N variants updated" means
    // something and a no-op save is not a write.
    const changed = updates.filter((update) => {
      const variant = product.variants.find((candidate) => candidate.id === update.id)!;
      return (
        update.stock !== variant.stock || update.priceCents !== variant.priceCents
      );
    });
    if (changed.length === 0) return;

    setSavingStock(true);
    try {
      const res = await api<AdminProduct>(`/admin/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({ variants: changed }),
      });
      // The response carries the recomputed rollups (stock total, effective price), which is
      // why the whole product is replaced rather than just the rows that were typed.
      setProduct(res.data);
      setVariantDraft(draftFrom(res.data));
      setErrors({});
      toast.success(res.message || "Stock updated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not save stock");
    } finally {
      setSavingStock(false);
    }
  }

  async function setStatus(value: string) {
    if (!product || value === product.status || changingStatus) return;

    setChangingStatus(true);
    try {
      const res = await api<AdminProduct>(`/admin/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      // Everything in the response is applied, but the form is deliberately *not* rebuilt
      // from it: it may hold edits the admin has not saved yet, and re-seeding it from the
      // server here would quietly throw those away. `form` is only reset by saveDetails.
      setProduct(res.data);
      toast.success(`Product is now ${(STATUS_LABELS[value] ?? value).toLowerCase()}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not change status");
    } finally {
      setChangingStatus(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (loadError || !product || !form) {
    return (
      <Container className="max-w-6xl p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">
              {loadError === "Product not found"
                ? "Product not found"
                : "Could not load this product"}
            </p>
            {loadError && loadError !== "Product not found" && (
              <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            )}
            <Button asChild className="mt-4">
              <Link href="/admin/products">Back to products</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{form.title || "Untitled product"}</h1>
          <Badge>{STATUS_LABELS[product.status] ?? product.status}</Badge>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/products">Back to products</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>
                What the marketplace shows. Nothing here is live until it is saved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveDetails} className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="product-title">Title</Label>
                    <Input
                      id="product-title"
                      value={form.title}
                      onChange={(event) => setField("title", event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="product-slug">Slug</Label>
                    <Input
                      id="product-slug"
                      value={form.slug}
                      onChange={(event) => setField("slug", event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      marketplace/{form.slug || "…"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-brief">Short description</Label>
                  <Input
                    id="product-brief"
                    value={form.brief}
                    placeholder="One line under the product title"
                    onChange={(event) => setField("brief", event.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-description">Description</Label>
                  <Textarea
                    id="product-description"
                    rows={8}
                    value={form.description}
                    onChange={(event) => setField("description", event.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="product-category">Category</Label>
                    <Select
                      value={form.categoryId || "none"}
                      onValueChange={(value) =>
                        setField("categoryId", value === "none" ? "" : value)
                      }
                    >
                      <SelectTrigger id="product-category" className="w-full">
                        <SelectValue placeholder="No category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No category</SelectItem>
                        {categoryOptions.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="product-discount">Discount %</Label>
                    <Input
                      id="product-discount"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={form.discountPercent}
                      onChange={(event) =>
                        setField("discountPercent", event.target.value)
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      0 for full price. Applies to every variant at once.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={!detailsDirty || savingDetails}>
                    {savingDetails ? <Spinner /> : "Save changes"}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {detailsDirty ? "Unsaved changes" : "All changes saved"}
                  </span>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stock &amp; pricing</CardTitle>
              <CardDescription>
                Per variant. Price is the full price — any discount is applied on top.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {product.variants.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This product has no variants, so there is nothing to count.
                </p>
              )}

              {product.variants.map((variant) => {
                const draft = variantDraft[variant.id] ?? {
                  stock: String(variant.stock),
                  price: centsToInput(variant.priceCents),
                };
                const stockError = errors[`${variant.id}.stock`];
                const priceError = errors[`${variant.id}.price`];

                return (
                  <div
                    key={variant.id}
                    className="grid gap-3 border-b pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_8rem_10rem] sm:items-start"
                  >
                    <div className="sm:pt-6">
                      <p className="font-medium">{variant.name}</p>
                      <p className="text-xs text-muted-foreground">{variant.sku}</p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`stock-${variant.id}`}>Stock</Label>
                      <Input
                        id={`stock-${variant.id}`}
                        inputMode="numeric"
                        value={draft.stock}
                        aria-invalid={Boolean(stockError)}
                        onChange={(event) =>
                          setVariantDraft((current) => ({
                            ...current,
                            [variant.id]: {
                              ...draft,
                              stock: event.target.value,
                            },
                          }))
                        }
                      />
                      {stockError && (
                        <p className="text-xs text-destructive">{stockError}</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`price-${variant.id}`}>
                        Price ({product.currency})
                      </Label>
                      <Input
                        id={`price-${variant.id}`}
                        inputMode="decimal"
                        value={draft.price}
                        aria-invalid={Boolean(priceError)}
                        onChange={(event) =>
                          setVariantDraft((current) => ({
                            ...current,
                            [variant.id]: {
                              ...draft,
                              price: event.target.value,
                            },
                          }))
                        }
                      />
                      {priceError && (
                        <p className="text-xs text-destructive">{priceError}</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {product.variants.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => void saveStock()}
                    disabled={changedVariants.length === 0 || savingStock}
                  >
                    {savingStock ? <Spinner /> : "Save stock"}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {changedVariants.length > 0
                      ? `${changedVariants.length} variant${changedVariants.length === 1 ? "" : "s"} with unsaved changes`
                      : "All changes saved"}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Active is the only state a shopper can see.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {STATUSES.map((option) => {
                const active = product.status === option.value;
                return (
                  <div
                    key={option.value}
                    className={`rounded-lg border p-3 ${
                      active ? "border-primary/40 bg-primary/5" : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{option.label}</span>
                      {active ? (
                        <Badge>Current</Badge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={changingStatus}
                          onClick={() => void setStatus(option.value)}
                        >
                          {changingStatus ? (
                            <Spinner />
                          ) : (
                            `Set ${option.label.toLowerCase()}`
                          )}
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{option.hint}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Price</span>
                <span className="font-medium tabular-nums">
                  {formatMoney(product.priceCents, product.currency)}
                </span>
              </div>
              {product.discountPercent > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">List price</span>
                  <span className="tabular-nums text-muted-foreground line-through">
                    {formatMoney(product.minPriceCents, product.currency)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">In stock</span>
                <span className="tabular-nums">
                  {product.stockTotal} across {product.variants.length} variant
                  {product.variants.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Rating</span>
                <span className="flex items-center gap-2">
                  <Rating value={product.ratingAvg} />
                  <span className="tabular-nums text-muted-foreground">
                    {product.ratingCount}
                  </span>
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Category</span>
                <span>{product.category?.name ?? "None"}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Updated</span>
                <span>{new Date(product.updatedAt).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          {product.images.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Images</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {product.images.map((image) => (
                  // Plain <img>: /uploads is served by nginx on this origin, and adding a
                  // loader for it would buy nothing here.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={image.id}
                    src={image.url}
                    alt={image.alt ?? product.title}
                    className="size-16 rounded-md border object-cover"
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Container>
  );
}

export default function EditProductRoute() {
  return (
    <AuthGate>
      <EditProductPage />
    </AuthGate>
  );
}
