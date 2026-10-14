"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import Container from "./container";
import { isActive } from "./nav-items";
import type { AccountSection } from "./account-nav";

interface AccountShellProps {
  /** Which section we're inside — supplies the heading, the one-liner and the link list.
   *  Defined alongside the links in account-nav.ts so the two cannot drift apart. */
  section: AccountSection;
  children: React.ReactNode;
}

/**
 * The two-column frame shared by the account sections.
 *
 * Applied per page rather than as a route-group layout, so each page picks its section and the
 * shell stays a plain frame instead of a route that decides what wraps it. The trade is that a
 * page outside the chosen list — /profile/orders, the address editor — renders without a
 * sidebar; those are reached from elsewhere in the app and are not settings screens.
 *
 * Everything the shell draws comes from `section`, passed as one object rather than as
 * title/description/items: a page that supplied three separate props could name its section
 * "Profile" and list the settings links beside it, and nothing would object.
 *
 * Reuses `isActive` from nav-items.ts rather than re-deciding what "current" means — that test
 * is prefix-based for a reason: /profile/addresses/abc must keep "Addresses" lit, which an
 * equality check would break, and a second copy of the rule is a second thing to keep in step.
 * AccountNavItem is a superset of NavItem, so it passes straight through.
 *
 * Below md the sidebar becomes a horizontal scrolling row rather than collapsing behind a
 * disclosure. Three destinations do not need a menu to be hidden, and a row keeps every
 * section one tap away without adding a control the shopper has to learn.
 */
export default function AccountShell({
  section,
  children,
}: AccountShellProps) {
  const pathname = usePathname();
  const { title, description, items } = section;

  return (
    <Container className="py-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </header>

      <div className="flex flex-col gap-8 md:flex-row">
        <nav
          aria-label={`${title} sections`}
          className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:w-60 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0"
        >
          {items.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-max items-start gap-3 rounded-lg px-3 py-2 transition-colors md:min-w-0",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    active && !item.destructive && "text-foreground",
                    item.destructive && "text-destructive"
                  )}
                />
                <span className="flex flex-col">
                  <span className={cn("text-sm", item.destructive && "text-destructive")}>
                    {item.label}
                  </span>
                  {item.description && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* min-w-0 so a wide table or a long unbroken string inside shrinks instead of forcing
            the whole row wider than the viewport. */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Container>
  );
}
