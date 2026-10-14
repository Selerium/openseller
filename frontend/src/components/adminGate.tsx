"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui/spinner";

/**
 * Gate for the (admin) route group.
 *
 * The admin pages moved out of (shop) into their own group so the navbar can be role-shaped:
 * a shopper gets Home/Marketplace/Orders, an admin gets the back office. That split is only worth
 * anything if the routes behind it are actually kept apart, so this is the other half — a signed-in
 * shopper who types /admin/orders is sent back to the storefront instead of landing on a page
 * whose every API call answers 403.
 *
 * Two rejections, and they are not the same:
 *
 *   - `!user`    — no session. src/proxy.ts already redirects anyone without an access_token cookie,
 *     so reaching this branch means the cookie exists but does not verify. /login keeps the current
 *     path in `redirect`, so the shopper lands back here after logging in.
 *   - wrong role — a valid session that is not an admin. Redirected to / rather than to /login,
 *     because logging in again cannot help; the account is simply not this one.
 *
 * This is a navigation guard, not a security boundary. The role claim is read from /me, and the
 * real enforcement is the backend's requireAdmin on every /admin endpoint — see
 * backend/src/middleware/requireAdmin.ts. proxy.ts cannot do this job itself: the access token is a
 * JWT signed with JWT_SECRET, which the frontend never has, so anything the proxy read out of the
 * cookie would be unverified.
 *
 * `router.replace` rather than window.location.href: this is a client-side redirect within the app,
 * and the router keeps the history clean. (auth-gate.tsx predates this and hard-navigates; both are
 * correct, this one is cheaper.)
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const signedOut = !loading && !user;
  const wrongRole = !loading && !!user && user.role !== "ADMIN";
  const rejected = signedOut || wrongRole;

  useEffect(() => {
    if (signedOut) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    } else if (wrongRole) {
      router.replace("/");
    }
  }, [signedOut, wrongRole, pathname, router]);

  // Spinner covers the redirect as well as the fetch: a blank frame between deciding to leave and
  // leaving reads as a broken page, and rendering the page first would flash admin content.
  if (loading || rejected) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return <>{children}</>;
}