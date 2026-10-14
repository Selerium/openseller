"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isPreviewMessage, type HomeLayout, type PreviewMessage } from "./types";

/**
 * The draft-preview toggle: the storefront itself, in an iframe, at editor width.
 *
 * An iframe rather than an inline re-render because the thing worth previewing is the *real*
 * page — header, theme, fonts, the storefront's own catalog fetches — and a second, inlined
 * copy of that would drift from it the first time the storefront changed.
 *
 * It points at `/`, but it does not show what `/` fetches. The published tree cannot answer
 * "what would this draft look like": the draft lives in this editor and in the admin-only
 * draft PUT, and a shopper's page only ever reads what is published. So the two windows
 * exchange it directly — the page asks on mount, this frame answers with the whole tree and
 * pushes every later change while the frame is open. The handshake is spelled out in
 * `PreviewMessage` (types.ts); what lands on screen is the draft wearing the real
 * storefront's clothes, which is what Publish is about to make literal.
 *
 * Both ends verify origin and source before trusting a message. Without that, any page that
 * managed to embed the storefront could hand it a layout to render for every visitor.
 */
export default function PreviewFrame({
  layout,
  onClose,
}: {
  /** The draft as it stands — this, not the published tree, is what the frame shows. */
  layout: HomeLayout;
  onClose: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Whether the page inside has made its request yet. Nothing can be pushed before that:
  // a message its listener has not registered is a message nobody receives.
  const readyRef = useRef(false);
  // Kept in a ref so the request reply (registered once, on mount) sends the current draft
  // rather than the one that happened to be in scope when the frame opened.
  const layoutRef = useRef(layout);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isPreviewMessage(event.data) || event.data.kind !== "homepage-preview-request") {
        return;
      }

      readyRef.current = true;
      iframeRef.current?.contentWindow?.postMessage(
        { kind: "homepage-preview", layout: layoutRef.current } satisfies PreviewMessage,
        window.location.origin,
      );
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Re-push on every commit of the tree. Structural edits happen while the canvas is open,
  // but Discard can swap the draft under the preview from the header, and a preview that
  // silently kept the previous tree would be previewing nothing real.
  useEffect(() => {
    layoutRef.current = layout;
    if (!readyRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      { kind: "homepage-preview", layout } satisfies PreviewMessage,
      window.location.origin,
    );
  }, [layout]);

  return (
    <div className="flex h-full min-h-[70vh] flex-col overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Showing the <span className="font-medium text-foreground">draft</span> homepage at{" "}
          <code>/</code> — publish to make it what visitors see.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setReloadKey((key) => key + 1)}
            title="Reload the preview"
          >
            <RefreshCw className="size-3.5" />
            Reload
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            title="Back to the editor"
          >
            <X className="size-3.5" />
            Close
          </Button>
        </div>
      </div>

      {/* Keyed on reloadKey so Reload remounts the document: a fresh mount re-runs everything
          the page does on load — its catalog fetches above all — which no amount of draft
          pushing can. The draft re-arrives the moment the new document asks for it. */}
      <iframe
        key={reloadKey}
        ref={iframeRef}
        src="/"
        title="Draft homepage preview"
        className="min-h-[60vh] w-full flex-1 bg-background"
      />
    </div>
  );
}
