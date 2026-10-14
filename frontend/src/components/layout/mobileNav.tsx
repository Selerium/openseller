"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/auth-context";
import { isActive, primaryNav, showsCart } from "./nav-items";

/**
 * The nav for viewports too narrow for the row.
 *
 * The header draws the full link row at md and up, so below that the same links need somewhere to
 * live. It reads the list from nav-items rather than taking it as a prop, so the drawer and the
 * row cannot drift apart — the item list has exactly one source either way.
 *
 * Wrapping each entry in SheetClose is what makes the drawer close on navigation. Navigating with
 * the sheet still open would leave it covering the page it just moved to.
 */
export default function MobileNav({
  user,
  onLogout,
}: {
  user: User | null;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const items = primaryNav(user);

  const linkClass = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-2 text-sm transition-colors",
      active
        ? "bg-muted font-medium text-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full md:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-72">
        <SheetTitle className="text-sm font-medium text-muted-foreground">
          Menu
        </SheetTitle>

        <nav className="flex flex-col gap-1">
          {items.map((item) => (
            <SheetClose asChild key={item.href}>
              <Link href={item.href} className={linkClass(isActive(item, pathname))}>
                {item.label}
              </Link>
            </SheetClose>
          ))}
        </nav>

        <div className="my-1 h-px bg-border" />

        {/* Account entries are repeated from the avatar dropdown rather than reused, because a
            dropdown item and a drawer row are different components; the destinations are the
            same two links plus logout. */}
        {user ? (
          <div className="flex flex-col gap-1">
            <SheetClose asChild>
              <Link href="/profile" className={linkClass(pathname === "/profile")}>
                Profile
              </Link>
            </SheetClose>
            <SheetClose asChild>
              <Link
                href="/settings"
                className={linkClass(pathname.startsWith("/settings"))}
              >
                Settings
              </Link>
            </SheetClose>
            <SheetClose asChild>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
              >
                Logout
              </button>
            </SheetClose>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <SheetClose asChild>
              <Button variant="outline" asChild>
                <Link href="/login">Log in</Link>
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button asChild>
                <Link href="/register">Sign up</Link>
              </Button>
            </SheetClose>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}