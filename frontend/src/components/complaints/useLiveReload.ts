"use client";

import { useEffect, useRef } from "react";
import { subscribe } from "@/lib/realtime";

/**
 * Re-read when something arrives live.
 *
 * Used where the socket is the tripwire and REST is the truth: a complaint thread
 * re-reads on `message.created` / `complaint.updated` instead of merging frames into
 * local state, so what renders is always what the server holds (including side effects
 * like reopening, which a merge would have to duplicate). Draft text is safe — the
 * reply box owns its own state and is never unmounted by a re-read.
 */
export function useLiveReload(
  channels: string[],
  reload: () => void,
): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // Serialised as the dep so the subscription tracks channel membership, not renders:
  // without it every parent render would tear every channel down and rebuild it.
  const key = JSON.stringify([...channels].sort());

  useEffect(() => {
    const list = JSON.parse(key) as string[];
    if (list.length === 0) return;
    let cancelled = false;
    // One reload per burst, not one per frame: a reopen publishes message.created and
    // complaint.updated back-to-back, and two GETs for one fact is one too many.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubs = list.map((channel) =>
      subscribe(channel, () => {
        if (cancelled) return;
        if (timer !== null) return;
        timer = setTimeout(() => {
          timer = null;
          if (!cancelled) reloadRef.current();
        }, 400);
      }),
    );
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unsubs.forEach((unsub) => unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
