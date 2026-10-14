"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { homeHref } from "@/components/layout/nav-items";
import { Spinner } from "@/components/ui/spinner";

/**
 * Gate for the pages that only make sense with no session.
 *
 * The inverse of auth-gate.tsx: /login and /register are reachable by anyone, so a signed-in
 * shopper following an old bookmark or a stale "Log in" link lands on a form whose only possible
 * outcome is an error — "Email already in use" on a register form they cannot meaningfully fill in
 * is the worst version of that.
 *
 * The redirect target is homeHref() rather than a literal "/", because that is already the one
 * definition of "where this user's home is" — an admin's is the dashboard, not the storefront.
 * Hardcoding "/" here would have been the second, subtly different answer.
 *
 * Unlike AuthGate, `loading` renders the children rather than a spinner. The reason AuthGate
 * hides its page is that flashing protected content at a signed-out visitor is a real harm; that
 * does not transfer here, because a login form contains nothing secret. Meanwhile AuthProvider
 * lives in the root layout, so /me is already in flight on every page load — and the login form
 * does not depend on its result. Blocking paint on it would make the one page every stuck
 * visitor lands on wait on a round trip it has no use for, turning an instantly-painted form
 * into a blank frame. A signed-in shopper therefore sees the form for the ~100ms it takes /me to
 * come back, which costs them nothing: there is nothing to protect and nothing they can have
 * typed yet.
 *
 * The fallback is also safer. If /me hangs, `loading` never clears and this gate simply does
 * nothing — the form stays usable — where AuthGate's equivalent would leave a blank page.
 *
 * Client-side rather than in src/proxy.ts because the session lives in an httpOnly cookie the
 * proxy cannot verify: it only sees that an access_token is *present*, which is also true of an
 * expired one. Redirecting on presence would bounce a shopper holding a stale cookie off /login
 * and into a loop, since the only route back to /login is not being signed in.
 *
 * DO NOT wrap /reset-password or /verify-email in this, even though they sit in the same (auth)
 * route group and are reached the same way. They are not sign-in pages: they are the destination
 * of a link sent by email, and the person opening that link may well already be signed in — on
 * another account, in another tab, or simply not thinking about it. They are the one case where
 * "nobody needs this page while logged in" is false, because "logged in" is the accident, not the
 * intent.
 *
 *   - /reset-password is a form, so the shopper is bounced home mid-task and cannot enter the new
 *     password at all. The token is single-use, so they have to request another email and log out
 *     first. The reset silently stops working for anyone who happened to be signed in.
 *   - /verify-email is worse, because it POSTs from a mount effect rather than waiting for a
 *     click. The request does fire, then the gate navigates away, so the shopper never sees the
 *     outcome and cannot tell whether their address verified. Should the gate ever be changed to
 *     hide its children while `loading` (as AuthGate does), the token would be consumed with
 *     nobody told, which is unfixable.
 *
 * /forgot-password is gated. It has no token and nothing to lose: a signed-in shopper who wants
 * it has already proven they know the password.
 *
 * /login is exempt for one case only -- a session whose address is unconfirmed. See
 * verificationPending above; the sign-in form is the only place that can resend a verification
 * mail, so gating it there removes the user's only route back into the account.
 */
export default function GuestGate({ children }: { children: React.ReactNode }) {
  const { user, loading, verificationPending } = useAuth();

  // The one carve-out in this component. A user whose address is unconfirmed cannot log in --
  // POST /login answers 403 until the address is verified -- so redirecting them off this page is
  // what produced the dead end this flag exists to close: they changed their email, followed the
  // "log in again" prompt, and were bounced straight back to the account page they came from,
  // with the resend form never appearing. Their session is real, but it is not a session that
  // grants them what this page offers, so it must not stand as a reason to leave.
  const redirecting = !loading && !!user && !verificationPending;

  // The destination as a string rather than derived inside the effect, so the dependency does not
  // change identity between renders. Depending on `user` would re-fire the effect whenever the
  // context handed out a new object for the same session, which AuthGate avoids the same way.
  const target = redirecting ? homeHref(user) : null;

  // In an effect, not during render: assigning window.location.href is a side effect and render
  // must stay pure, or React may run it more than once.
  useEffect(() => {
    if (target) window.location.href = target;
  }, [target]);

  // Only the redirect itself is covered. A blank frame between deciding to leave and actually
  // leaving reads as a broken page.
  if (redirecting) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return <>{children}</>;
}