import AdminGate from "@/components/adminGate";

/**
 * The back office shell.
 *
 * Separate from (shop) so the navbar can be role-shaped — nav-items.ts shows an admin the admin
 * links and a shopper the storefront links, which only means something if the two halves are not
 * sharing a layout. The URLs are unchanged (/admin/* either way), so proxy.ts needed no edit.
 *
 * No header of its own: the global one in app/layout.tsx is already showing the four admin links
 * for a user with the admin role, and a second bar under it would say the same thing twice. What
 * this layout adds is the gate, so a shopper who reaches an admin URL by typing it is turned away
 * before the page's API calls start failing.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminGate>{children}</AdminGate>;
}