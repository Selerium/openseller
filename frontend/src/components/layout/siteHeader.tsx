"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import CartButton from "@/components/storefront/cartButton";
import NotificationBell from "@/components/notifications/notificationBell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Container from "./container";
import MobileNav from "./mobileNav";
import { homeHref, isActive, primaryNav, showsCart } from "./nav-items";

/**
 * The one header, and it is global.
 *
 * It used to belong to the (shop) route group, which meant /, /login, /register and the rest of
 * the auth pages rendered with no chrome at all and a different width from everything else. The
 * app now has a single shell in app/layout.tsx, and this bar is part of it: every route gets the
 * same header, at the same width, and the bar itself branches on who is signed in.
 *
 * Which links appear is decided in nav-items.ts, not here. Guests get Home and Marketplace,
 * shoppers also get Orders, admins get the back office instead — see that file for why Orders is
 * hidden from guests rather than left to bounce off proxy.ts.
 *
 * The right-hand side is the other half of that branch: the profile/settings dropdown for a
 * session, and Log in / Sign up in its place when there is none.
 */
export default function SiteHeader() {
  const { user, refreshUser } = useAuth();
  const pathname = usePathname();
  const idem = useIdempotency();

  const items = primaryNav(user);
  // Same build-time source as the homepage placeholder: NEXT_PUBLIC_STORE_NAME.
  const storeName = process.env.NEXT_PUBLIC_STORE_NAME || "sampledomain";

  async function handleLogout() {
    try {
      await idem.run((idempotencyKey) =>
        api("/logout", { method: "POST", idempotencyKey })
      );
    } catch {
      // logout clears cookies regardless
    }
    await refreshUser();
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <Container className="flex h-14 items-center gap-4">
        <Link href={homeHref(user)} className="flex items-center gap-2 font-semibold">
          <Store className="size-4" />
          <span>{storeName}</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item, pathname) ? "page" : undefined}
              className={cn(
                "rounded-lg px-2 py-1 text-sm transition-colors",
                isActive(item, pathname)
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* The row above is hidden below md, so this takes over as the element that pushes the
            cart and the account menu to the right edge. */}
        <div className="flex-1 md:hidden" aria-hidden />

        {showsCart(user) && <CartButton />}

        <NotificationBell />

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar size="lg">
                  <AvatarFallback>{user.name?.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="sr-only">Open account menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={user.role === "ADMIN" ? "/admin/notifications" : "/profile/notifications"}
                >
                  Notifications
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/register">Sign up</Link>
            </Button>
          </div>
        )}

        <MobileNav user={user} onLogout={handleLogout} />
      </Container>
    </header>
  );
}