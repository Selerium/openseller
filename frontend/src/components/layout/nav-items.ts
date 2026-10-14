import type { User } from "@/lib/auth-context";

/**
 * What the navbar shows, derived from who is signed in.
 *
 * One list, computed in one place, because the header and the mobile drawer have to agree — two
 * copies of this is how a link ends up on the desktop bar and missing from the phone.
 *
 * Three audiences:
 *
 *   - guest    — Home and Marketplace only. Orders is absent rather than shown-and-bounced:
 *                /profile/orders is behind proxy.ts, so offering it would advertise a route that
 *                answers with a redirect to /login. The cart is present, because a cart belongs to
 *                the browser rather than to a session.
 *   - shopper  — the guest links plus Orders.
 *   - admin    — the back office only. An admin's primary destination is /admin/dashboard, not
 *                the storefront, so the storefront links (and the cart, which is part of that
 *                side of the app) are left out rather than padded on top.
 *
 * `exact` marks a link that should only light up on its own path. Needed for Home: without it
 * every route is a child of `/` and the bar would show Home as active everywhere.
 */
export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

export function primaryNav(user: User | null): NavItem[] {
  if (user?.role === "ADMIN") {
    return [
      { href: "/admin/dashboard", label: "Dashboard" },
      { href: "/admin/homepage", label: "Homepage" },
      { href: "/admin/products", label: "Products" },
      { href: "/admin/orders", label: "Orders" },
      { href: "/admin/complaints", label: "Complaints" },
    ];
  }

  const items: NavItem[] = [
    { href: "/", label: "Home", exact: true },
    { href: "/marketplace", label: "Marketplace" },
  ];

  if (user) items.push({ href: "/profile/orders", label: "Orders" });

  return items;
}

/** Where the logo points: an admin's home is the dashboard, everyone else's is the home page. */
export function homeHref(user: User | null): string {
  return user?.role === "ADMIN" ? "/admin/dashboard" : "/";
}

/** Whether the cart belongs in the bar for this user. Guests have carts; admins are in the back office. */
export function showsCart(user: User | null): boolean {
  return user?.role !== "ADMIN";
}

/**
 * Active-link test, by prefix rather than equality so a detail page still lights up the section
 * it belongs to — /marketplace/wool-scarf under Marketplace, /admin/products/new under Products,
 * /profile/orders/123 under Orders.
 */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}