"use client";

import { useEffect, useRef } from "react";

/**
 * One shared socket for live updates (complaint threads, notification bell).
 *
 * The backend speaks JSON frames at /realtime (see backend/src/lib/realtime.ts): we send
 * `{type:"subscribe", channel}` and it sends `{type:"event", channel, event, data}`.
 * Auth rides the session cookie, so same-origin sockets need no token; guests append
 * `?guestToken=` from the checkout handoff in sessionStorage.
 *
 * A single connection is shared no matter how many hooks subscribe: channels are
 * reference-counted in this module, and the socket reconnects with backoff, resending
 * every outstanding subscribe on open. Anything missed while offline is not lost — the
 * Notification rows and the REST reads behind each view are the record; the socket is
 * only the fast path.
 */

type Handler = (event: string, data: any) => void;

const subscribers = new Map<string, Set<Handler>>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let guestToken: string | null = null;

function realtimeUrl(): string {
  // Mirrors lib/api.ts: NEXT_PUBLIC_API_URL is the API origin (with or without the /api
  // tail), otherwise the socket is same-origin. Either way the path the backend serves
  // the upgrade on is /realtime under the /api prefix nginx strips.
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
  const http = base && base.length > 0 ? base.replace(/\/api$/, "") : window.location.origin;
  return `${http.replace(/^http/, "ws")}/api/realtime`;
}

function connect(): void {
  if (typeof window === "undefined") return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    guestToken =
      window.sessionStorage.getItem("guestToken") ?? guestToken;
  } catch {
    // Private browsing: live updates simply stay off, every view still reads over REST.
  }

  const url = guestToken
    ? `${realtimeUrl()}?guestToken=${encodeURIComponent(guestToken)}`
    : realtimeUrl();

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    reconnectDelay = 1000;
    for (const channel of subscribers.keys()) {
      ws.send(JSON.stringify({ type: "subscribe", channel }));
    }
  };

  ws.onmessage = (incoming) => {
    let frame: { type?: unknown; channel?: unknown; event?: unknown; data?: unknown };
    try {
      frame = JSON.parse(String(incoming.data));
    } catch {
      return;
    }
    if (frame.type !== "event" || typeof frame.channel !== "string") return;
    const handlers = subscribers.get(frame.channel);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(String((frame as { event?: unknown }).event ?? ""), (frame as { data?: unknown }).data);
      } catch {
        // One bad subscriber must not starve the rest of the channel.
      }
    }
  };

  const dropped = () => {
    if (socket === ws) socket = null;
    scheduleReconnect();
  };
  ws.onclose = dropped;
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      // Already gone; onclose below schedules the reconnect.
    }
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  // Back off to 30s so a dead backend is one quiet retry loop, not a spin.
  const wait = Math.min(reconnectDelay, 30000);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // Reconnect only while somebody is still listening; otherwise stay dark until the
    // next subscribe.
    if (subscribers.size > 0) connect();
  }, wait);
}

export function subscribe(channel: string, handler: Handler): () => void {
  let handlers = subscribers.get(channel);
  if (!handlers) {
    handlers = new Set();
    subscribers.set(channel, handlers);
  }
  handlers.add(handler);

  connect();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "subscribe", channel }));
  }

  return () => {
    const current = subscribers.get(channel);
    if (current) {
      current.delete(handler);
      if (current.size === 0) subscribers.delete(channel);
    }
    if (subscribers.size === 0) {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectDelay = 1000;
      if (socket) {
        try {
          socket.close();
        } catch {
          // Already gone.
        }
        socket = null;
      }
    }
  };
}

/**
 * Listen on one channel for the life of the component.
 *
 * `handler` is kept in a ref so resubscribing tracks channel changes only, not every
 * render's new closure — otherwise each keystroke in a reply box would tear the
 * subscription down and rebuild it.
 */
export function useRealtimeChannel(
  channel: string | null,
  handler: (event: string, data: any) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!channel) return;
    return subscribe(channel, (event, data) => handlerRef.current(event, data));
  }, [channel]);
}
