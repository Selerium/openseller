/**
 * Shapes the storefront reads from the public catalog API.
 *
 * Declared here rather than imported from the backend because the backend is plain node with
 * type-stripping and no typecheck (see the README): there is no build step that could produce a
 * consumable .d.ts, so a shared package would mean hand-maintaining types on both sides. These
 * are the response shapes as documented by backend/src/controllers/catalog/products.ts,
 * backend/src/controllers/catalog/categories.ts and backend/src/lib/catalog.ts.
 */

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  /** After the product markdown. What to charge. */
  priceCents: number;
  /** Pre-discount, or null when the product is not discounted. */
  listPriceCents: number | null;
  inStock: boolean;
  quantity: number;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  brief: string;
  description: string;
  category: { id: string; name: string; slug: string } | null;
  currency: string;
  images: { id: string; url: string; alt: string | null }[];
  variants: ProductVariant[];
  priceCents: number;
  listPriceCents: number | null;
  discountPercent: number;
  priceFrom: boolean;
  inStock: boolean;
  quantity: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: string;
  authorName: string;
  authorInitials: string;
}

/** The pagination envelope every list endpoint returns (see lib/http.ts pageOf). */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}