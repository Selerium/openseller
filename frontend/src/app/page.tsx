"use client";

import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ShoppingBag } from "lucide-react";
import Container from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import RenderLayout from "@/components/homepage/renderLayout";
import { isPreviewMessage, type HomeLayout } from "@/components/homepage/types";

/**
 * Home.
 *
 * Fetches the published homepage and renders it with the same renderer the editor previews
 * with, so the page a visitor gets is the page the admin arranged. The fetch is this page's
 * own rather than a layout-level one because the storefront must never fail closed: if the
 * request errors, or nothing has ever been published, or what was published has no sections
 * left in it, this renders the placeholder below — the same markup this page showed before
 * the editor existed, and the same one a brand-new store shows.
 *
 * `null` (never published) and an empty tree (published with everything deleted) both land on
 * that placeholder. They are different states to the API — which is what lets the editor say
 * "unpublished changes" for a page nobody has seen — but to a visitor they mean the same
 * thing: the site has not built its front door yet.
 *
 * The one exception to "published" is the editor's own preview: while the admin previews,
 * this page is inside their iframe, it asks for the draft over postMessage, and renders that
 * instead (`PreviewMessage` in components/homepage/types.ts). A visitor's top-level page has
 * no parent window to ask, so nothing about this branch changes for them.
 *
 * The firstTime redirect does stay. A shopper who has not finished onboarding has no profile
 * to land on, and letting them browse from a half-built account is worse than one redirect.
 */
export default function HomePage() {
  const { user, loading } = useAuth();
  // undefined is "not answered yet", which keeps the placeholder from flashing before the
  // request that decides whether there is a real page to show.
  const [layout, setLayout] = useState<HomeLayout | null | undefined>(undefined);
  // The editor's draft, once handed over. Also the fence across the fetch below: the reply
  // can land before the request settles, and a late `setLayout(published)` would flip the
  // preview back to the live tree mid-edit.
  const draftRef = useRef<HomeLayout | null>(null);

  useEffect(() => {
    if (!loading && user?.firstTime) {
      window.location.href = "/onboarding";
    }
  }, [user, loading]);

  // The preview half of the handshake. The page speaks first — it posts the request on
  // mount, because a message sent before its own listener exists is never received — then
  // renders whatever the editor replies with, and re-renders on every push after that.
  //
  // Both guards matter and are not interchangeable: `origin` is what stops a stranger's site
  // from embedding the storefront and injecting a layout every visitor would then see, and
  // `source` is what stops anything else on this origin from doing the same.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (!isPreviewMessage(event.data) || event.data.kind !== "homepage-preview") return;

      draftRef.current = event.data.layout;
      setLayout(event.data.layout);
    };

    window.addEventListener("message", onMessage);
    if (window.parent !== window) {
      window.parent.postMessage(
        { kind: "homepage-preview-request" },
        window.location.origin,
      );
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The envelope is { data: { layout, updatedAt } }: `data` is the document wrapper, not
        // the tree, and reading `res.data` as the tree here renders nothing but an error.
        const res = await api<{ layout: HomeLayout | null } | null>("/homepage");
        if (!cancelled && draftRef.current === null) setLayout(res.data?.layout ?? null);
      } catch {
        if (!cancelled && draftRef.current === null) setLayout(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || user?.firstTime || layout === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (layout === null || layout.sections.length === 0) {
    return <Placeholder user={user} />;
  }

  return <RenderLayout layout={layout} />;
}

/**
 * The default home page: everything the storefront had before the editor existed, unchanged.
 *
 * Shown whenever there is no published design, so the two branches of this page never have to
 * be maintained as two different things — the branch that was here first simply still is.
 */
function Placeholder({ user }: { user: { firstTime?: boolean } | null }) {
  // Baked in at `next build` from NEXT_PUBLIC_STORE_NAME, so the deploy script must have
  // written the frontend env before the first build. Falls back to the original name.
  const storeName = process.env.NEXT_PUBLIC_STORE_NAME || "sampledomain";
  return (
    <Container className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
      <h1 className="text-5xl font-bold">{storeName}</h1>
      <p className="text-lg text-muted-foreground">
        Connect, collaborate, and grow together.
      </p>

      {user ? (
        <div className="flex flex-wrap justify-center gap-4">
          <Button size="lg" asChild>
            <Link href="/marketplace">
              <ShoppingBag className="size-4" />
              Browse the marketplace
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/profile/orders">My orders</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-4">
          <Button size="lg" asChild>
            <Link href="/login">Log In</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/register">Sign Up</Link>
          </Button>
        </div>
      )}
    </Container>
  );
}
