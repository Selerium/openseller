import type { LucideIcon } from "lucide-react";
import {
  CreditCard,
  KeyRound,
  Mail,
  MapPin,
  Trash2,
  User,
} from "lucide-react";

/**
 * The section lists behind the account sidebars.
 *
 * One place for all of it, for the same reason nav-items.ts exists for the header: the shell only
 * knows how to draw links, and a page that spelled out its own list — or its own heading — would
 * be free to disagree with the others. The section titles live here rather than at each call site
 * for exactly that reason: three profile pages did each spell out "Profile" and the same
 * one-liner, so the copy changed in one place and not the other two until it was moved. Each page
 * now supplies a section and the heading, description and links come as one.
 *
 * `exact` is needed for the entries that are a page rather than a section: without it, "Personal
 * Info" at /profile would also light up on /profile/addresses, since every profile page is a
 * child of /profile.
 *
 * This is plain data with no hooks, so it stays out of the client boundary the shell and the
 * pages share — importing a `.ts` like this from a client component costs nothing.
 */
export interface AccountNavItem {
  href: string;
  label: string;
  /** One line explaining what the section holds, shown under the label on wide viewports. */
  description?: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Renders in the destructive colour, so the one irreversible destination is never mistaken
   *  for an ordinary one at a glance. */
  destructive?: boolean;
}

/** Everything AccountShell draws that belongs to the section rather than to a single page. */
export interface AccountSection {
  title: string;
  /** Optional one-liner under the heading. */
  description?: string;
  /** Which section list to draw. See AccountNavItem. */
  items: AccountNavItem[];
}

/**
 * The /profile sections. Orders is absent on purpose: it is its own top-level destination,
 * reached from the header bar, and is not part of the profile-settings group.
 */
export function profileSection(): AccountSection {
  return {
    title: "Profile",
    description: "Your details, and the other things attached to your account.",
    items: [
      {
        href: "/profile",
        label: "Personal Info",
        description: "Name, phone and nationality",
        icon: User,
        exact: true,
      },
      {
        href: "/profile/addresses",
        label: "Addresses",
        description: "Where your orders ship",
        icon: MapPin,
      },
      {
        href: "/profile/payment-methods",
        label: "Payment Methods",
        description: "Cards saved for faster checkout",
        icon: CreditCard,
      },
    ],
  };
}

/** The /settings sections, ordered so the reversible ones come first. */
export function settingsSection(): AccountSection {
  return {
    title: "Settings",
    items: [
      {
        href: "/settings/password",
        label: "Change Password",
        description: "Update the password you sign in with",
        icon: KeyRound,
      },
      {
        href: "/settings/email",
        label: "Change Email",
        description: "Where we send your receipts",
        icon: Mail,
      },
      {
        href: "/settings/delete",
        label: "Delete Account",
        description: "Permanently remove your account",
        icon: Trash2,
        destructive: true,
      },
    ],
  };
}
