"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * The conversation on a complaint, shared by the shopper's order view and the admin's
 * complaint detail.
 *
 * Your own messages sit on the right in the primary colour, the other side's on the
 * left as neutral bubbles — the chat convention, mirrored per viewer: a shopper sees
 * their own words right and "Support" left, an admin sees the mirror. The opening
 * description follows the same rule, so the thread reads top-to-bottom without a
 * separate card for it.
 *
 * Sending is owned by the caller (`onSend`), because the endpoint differs per side —
 * /complaints/:id/messages for the shopper, /admin/complaints/:id/messages for support —
 * but the failure handling is here, so both get the same disabled-while-sending button
 * and the same error toast.
 *
 * Liveness is owned by the caller too: pass the latest `complaint` (with messages) and
 * re-render whenever a `complaint.message` realtime event arrives — see useRealtime.
 */

export interface ThreadMessage {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ThreadComplaint {
  id: string;
  reason: string;
  details: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  /** Newest page, oldest-first. Older pages pull through `loadOlder`. */
  messages: ThreadMessage[];
  /** Whole-thread size, so the reader knows older pages exist. */
  messageCount: number;
}

export interface OlderPage {
  messages: ThreadMessage[];
  hasMore: boolean;
}

export function authorLabel(author: string, viewer: "customer" | "admin"): string {
  const isAdmin = author === "ADMIN";
  if (viewer === "customer") return isAdmin ? "Support" : "You";
  return isAdmin ? "You (support)" : "Customer";
}

/** True when the bubble belongs to whoever is looking at the thread. */
export function isOwnMessage(author: string, viewer: "customer" | "admin"): boolean {
  return viewer === "admin" ? author === "ADMIN" : author !== "ADMIN";
}

export default function ComplaintThread({
  complaint,
  viewer,
  onSend,
  closedHint,
  loadOlder,
}: {
  complaint: ThreadComplaint;
  viewer: "customer" | "admin";
  onSend: (body: string) => Promise<void>;
  /** Extra note under the reply box, e.g. "replying reopens a closed complaint". */
  closedHint?: string;
  /**
   * Pull the next older page above `beforeId`. Absent when the embedded tail is the
   * whole thread — short threads never page at all.
   */
  loadOlder?: (beforeId: string) => Promise<OlderPage>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Older pages, prepended above the embedded tail. Reset per thread: a new complaint id
  // means a new conversation, and stale older pages must not leak across it.
  const [older, setOlder] = useState<ThreadMessage[]>([]);
  const [hasMore, setHasMore] = useState(
    (complaint.messageCount ?? complaint.messages.length) > complaint.messages.length,
  );
  const [pulling, setPulling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOlder([]);
    setHasMore(
      (complaint.messageCount ?? complaint.messages.length) > complaint.messages.length,
    );
    // Newest page may itself have arrived newer than the last render (live re-read), so
    // land at the bottom for the latest words.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaint.id]);

  // One list, oldest-first, deduped: the embedded tail refreshes on every live re-read
  // and can overlap both the older pages and itself across renders.
  const thread = useMemo(() => {
    const seen = new Set<string>();
    const out: ThreadMessage[] = [];
    for (const message of [...older, ...complaint.messages]) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push(message);
    }
    return out;
  }, [older, complaint.messages]);

  // New arrivals pin to the bottom only when the reader is already there; someone
  // scrolled up through history must not be yanked down mid-read.
  const threadLength = thread.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadLength]);

  // Scrolling past the top pulls the next older page. The guard lives here rather than
  // in the handler so rapid scroll events collapse into one flight.
  async function pullOlder() {
    if (!loadOlder || pulling || !hasMore) return;
    const first = thread[0];
    if (!first) return;
    setPulling(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      const page = await loadOlder(first.id);
      setOlder((current) => {
        const seen = new Set(current.map((m) => m.id));
        const fresh = page.messages.filter((m) => !seen.has(m.id));
        return [...fresh, ...current];
      });
      setHasMore(page.hasMore);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not load older messages");
    } finally {
      setPulling(false);
      // Prepending grows the scrollable height above the viewport; pushing the offset
      // down by exactly the growth keeps the message under the eye exactly where it was.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      });
    }
  }

  function onScroll() {
    const el = scrollRef.current;
    if (el && el.scrollTop < 80) void pullOlder();
  }

  const isClosed = complaint.status === "RESOLVED" || complaint.status === "DISMISSED";

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      // Clear only what was sent: anything typed mid-flight is new words, not a resend.
      setDraft((current) => (current.trim() === body ? "" : current));
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not send your reply");
    } finally {
      setSending(false);
      // The box stays mounted and enabled throughout the flight, so focus never leaves —
      // this just guarantees the caret is back where the typist expects it.
      boxRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Fixed height with its own scroll: the thread starts at the bottom on the latest
          words, and scrolling up past the top pulls older pages in. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="max-h-96 overflow-y-auto pr-1"
      >
      <ol className="flex flex-col gap-3">
        {(pulling || hasMore) && (
          <li className="flex justify-center py-1">
            {pulling ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Loading older messages…
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Scroll up to load older messages
              </span>
            )}
          </li>
        )}
        {/* The filing itself opens the thread: the customer's words, so it sits on the
            customer's side for whoever is looking. */}
        <li
          className={cn(
            "flex flex-col gap-1",
            isOwnMessage("CUSTOMER", viewer) ? "items-end" : "items-start",
          )}
        >
          <span className="text-xs text-muted-foreground">
            {viewer === "customer" ? "You" : "Customer"} opened this complaint •{" "}
            {new Date(complaint.createdAt).toLocaleString()}
          </span>
          <p
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm",
              isOwnMessage("CUSTOMER", viewer)
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm border border-border bg-muted/40",
            )}
          >
            <span className="font-medium">{complaint.reason.replace(/_/g, " ")}</span>
            <span className="mt-0.5 block">{complaint.details}</span>
          </p>
        </li>

        {thread.map((message) => {
          const own = isOwnMessage(message.author, viewer);
          return (
            <li
              key={message.id}
              className={cn("flex flex-col gap-1", own ? "items-end" : "items-start")}
            >
              <span className="text-xs text-muted-foreground">
                {authorLabel(message.author, viewer)} •{" "}
                {new Date(message.createdAt).toLocaleString()}
              </span>
              <p
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  own
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-tl-sm border border-border bg-muted/40",
                )}
              >
                {message.body}
              </p>
            </li>
          );
        })}

        {thread.length === 0 && (
          <li className="text-xs text-muted-foreground">
            No replies yet — write the first one below.
          </li>
        )}
      </ol>
      </div>

      {complaint.resolution && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <span className="font-medium">Resolution: </span>
          {complaint.resolution}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          ref={boxRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={
            viewer === "customer" ? "Write a reply…" : "Reply as support…"
          }
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter keeps a newline — the chat convention. The box
            // is never disabled mid-send (a disabled field drops focus), so rapid
            // Enter presses collapse into the `sending` guard instead of a blur.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {isClosed && closedHint && (
          <p className="text-xs text-muted-foreground">{closedHint}</p>
        )}
        <Button
          type="button"
          size="sm"
          className="w-fit"
          disabled={!draft.trim() || sending}
          onClick={() => void send()}
        >
          {sending ? "Sending…" : (
            <>
              <Send className="size-3.5" />
              Send reply
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
