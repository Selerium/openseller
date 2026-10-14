"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui/spinner";

/**
 * Gate for the pages that need a signed-in shopper who has finished onboarding.
 *
 * This used to be the (protected) route group's layout. There is now one shell, (shop), for both
 * the public storefront and the account pages, so the checks cannot live in it — a first-time
 * user being redirected to onboarding would also be bounced off the marketplace, and the
 * storefront is the one part of this app that must never need an account. Applied per page
 * instead, which is where the condition actually belongs.
 *
 * Three states, and the middle one is why this exists at all:
 *
 *   - `loading`  — the session is being resolved. Spinner, because rendering the page first
 *     would flash protected content at a signed-out visitor before /me comes back.
 *   - `!user`    — no valid session. Renders nothing. src/proxy.ts already redirects anyone
 *     without an access_token cookie to /login, so reaching here means the cookie exists but
 *     does not verify; the page behind it would only fail on its own 401.
 *   - `firstTime` — signed in but has not completed onboarding, so there is no profile to show
 *     yet. Redirects rather than rendering an empty form on a page that will be replaced.
 *
 * Onboarding does not use this: it is the one page a first-time user is supposed to reach, and it
 * does its own inverse check, bouncing anyone who has already finished.
 *
 * A pending email verification renders the page with a banner rather than redirecting. The user
 * changed their address and is waiting on a link; the account is theirs and this page works. The
 * only reason it is worth mentioning is that verification gates login, so if they navigate to
 * /login expecting to switch accounts they will be refused with no context.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, verificationPending } = useAuth();
  const pathname = usePathname();

  const redirecting =
    !loading && !!user?.firstTime && pathname !== "/onboarding";

  // In an effect, not during render: assigning window.location.href is a side effect and render
  // must stay pure, or React may run it more than once.
  useEffect(() => {
    if (redirecting) window.location.href = "/onboarding";
  }, [redirecting]);

  // No session, but we know why: the last attempt came back 403-unverified rather than
  // 401-signed-out. Rendering nothing below leaves a blank page with no way forward, and the one
  // place that can send the mail is /login, so that is where they go.
  //
  // A redirect rather than an inline "verify your email" notice because /me cannot tell us the
  // address in this state (there is no session to look it up with), and a form asking for an
  // address the user just typed is worse than one that says what it is for.
  //
  // Declared above the early returns, which is why it is not down beside the banner it pairs
  // with: a hook after a conditional return runs a different number of times per render, and
  // React rejects the whole component when the count changes.
  useEffect(() => {
    if (!loading && !user && verificationPending) window.location.href = "/login";
  }, [loading, user, verificationPending]);

  // The spinner covers the redirect too, not just the fetch. A blank frame between deciding to
  // leave and actually leaving reads as a broken page.
  if (loading || redirecting) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      {verificationPending && <PendingVerificationBanner email={user.email} />}
      {children}
    </>
  );
}

/**
 * Shown while the signed-in user's address is unconfirmed.
 *
 * Dismissible, because it will otherwise sit above every account page until they click the mail
 * link, and a permanent banner over content is worse than none. Sending them away permanently
 * would be worse still: the session is valid, and the verification is one click from arriving.
 */
function PendingVerificationBanner({ email }: { email?: string }) {
  const [dismissed, setDismissed] = useState(false);

  // Dismissal is per-mount on purpose. Keyed to the address so that a *different* pending
  // address re-raises the banner rather than inheriting the earlier one's dismissal.
  useEffect(() => setDismissed(false), [email]);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm"
    >
      {email && (
        <>
          Your new address <span className="font-medium">{email}</span> is not confirmed yet.
        </>
      )}
      {!email && <>Your email address is not confirmed yet.</>} Check your inbox for the
      verification link.
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-3 underline underline-offset-4"
      >
        Dismiss
      </button>
    </div>
  );
}