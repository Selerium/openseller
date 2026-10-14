import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "./prismaClient.ts";

/**
 * Live updates: complaint threads and the notification bell, pushed instead of polled.
 *
 * One WebSocketServer on the same HTTP listener as Express (see index.ts), reached at
 * /realtime through the /api nginx proxy. Two channel kinds, both authorised at
 * subscribe time rather than at connect time:
 *
 *   complaint:<id>  the message thread + status of one dispute. A session whose profile
 *                   owns the complaint (or its order), or a guest holding the order's
 *                   one-time token, may listen.
 *   user:<profile>  one profile's notification inbox (shoppers and admins alike — an
 *                   admin's "new complaint filed" rows land here too).
 *
 * Messages are `{type:"subscribe", channel, guestToken?}` in and
 * `{type:"event", channel, event, data}` out. Anything else is answered with an error
 * frame and ignored, never trusted.
 *
 * Delivery is best-effort by design: a shopper who was offline when support replied
 * still has the Notification row waiting (see lib/notify.ts), so a dropped socket can
 * only delay, never lose. Scaling past one backend would mean moving `channels` into
 * Redis pub/sub; with a single instance a Map is the whole of it.
 */

const wss = new WebSocketServer({ noServer: true });

const channels = new Map<string, Set<WebSocket>>();
const socketChannels = new Map<WebSocket, Set<string>>();

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

interface Identity {
  profileId: string | null;
  role: string | null;
  guestToken: string | null;
}

function identify(req: IncomingMessage): Identity {
  const url = new URL(req.url ?? "/", "http://localhost");
  const guestToken = url.searchParams.get("guestToken");

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.access_token;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || "") as {
        id?: string;
        role?: string;
      };
      if (payload?.id) {
        return { profileId: payload.id, role: payload.role ?? null, guestToken };
      }
    } catch {
      // Expired or forged: fall through to guest handling rather than refusing the
      // socket — a guest thread needs no session at all.
    }
  }
  return { profileId: null, role: null, guestToken };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** The same ownership rule as the message REST endpoints: own complaint/order, or token. */
async function mayWatchComplaint(
  identity: Identity,
  complaintId: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(complaintId)) {
    return false;
  }
  // Support watches every thread: the admin detail and order pages subscribe the
  // complaint they are looking at, regardless of who filed it.
  if (identity.role === "ADMIN") return true;
  const complaint = await prisma.complaint.findUnique({
    where: { id: complaintId },
    select: {
      profileId: true,
      order: { select: { profileId: true, guestTokenHash: true } },
    },
  });
  if (!complaint || !complaint.order) return false;
  if (
    identity.profileId &&
    (complaint.profileId === identity.profileId ||
      complaint.order.profileId === identity.profileId)
  ) {
    return true;
  }
  if (identity.guestToken && complaint.order.guestTokenHash === sha256(identity.guestToken)) {
    return true;
  }
  return false;
}

function join(ws: WebSocket, channel: string): void {
  let members = channels.get(channel);
  if (!members) {
    members = new Set();
    channels.set(channel, members);
  }
  members.add(ws);

  let joined = socketChannels.get(ws);
  if (!joined) {
    joined = new Set();
    socketChannels.set(ws, joined);
  }
  joined.add(channel);
}

function leaveAll(ws: WebSocket): void {
  const joined = socketChannels.get(ws);
  if (joined) {
    for (const channel of joined) {
      const members = channels.get(channel);
      if (members) {
        members.delete(ws);
        if (members.size === 0) channels.delete(channel);
      }
    }
    socketChannels.delete(ws);
  }
}

/** Fan-out to every socket watching a channel. Never throws: a dead socket just skips. */
export function publish(channel: string, event: string, data: unknown): void {
  const members = channels.get(channel);
  if (!members || members.size === 0) return;
  const frame = JSON.stringify({ type: "event", channel, event, data });
  for (const ws of members) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frame, (err) => {
        if (err) leaveAll(ws);
      });
    }
  }
}

export function handleRealtimeUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): void {
  const identity = identify(req);

  // A socket with neither a session nor a guest token can watch nothing, so refusing it
  // here is cheaper than accepting and rejecting every subscribe.
  if (!identity.profileId && !identity.guestToken) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const state = { identity };

    ws.on("message", (raw) => {
      void (async () => {
        let parsed: { type?: unknown; channel?: unknown };
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Send JSON" }));
          return;
        }
        if (parsed.type !== "subscribe" || typeof parsed.channel !== "string") {
          ws.send(JSON.stringify({ type: "error", message: "Send {type:\"subscribe\", channel}" }));
          return;
        }

        const channel = parsed.channel;
        const complaintMatch = /^complaint:([0-9a-f-]{36})$/i.exec(channel);
        const userMatch = /^user:([0-9a-f-]{36})$/i.exec(channel);

        let allowed = false;
        if (complaintMatch) {
          allowed = await mayWatchComplaint(state.identity, complaintMatch[1]);
        } else if (userMatch) {
          // Your own inbox only. Admins watch theirs like everyone else — the rows addressed
          // to them are what carries "new complaint filed", not a shared channel.
          allowed = state.identity.profileId === userMatch[1];
        }

        if (!allowed) {
          ws.send(JSON.stringify({ type: "error", message: "Not subscribed", channel }));
          return;
        }
        join(ws, channel);
        ws.send(JSON.stringify({ type: "subscribed", channel }));
      })();
    });

    ws.on("close", () => leaveAll(ws));
    ws.on("error", () => leaveAll(ws));
  });
}

// Dead sockets are reaped, not trusted to close cleanly: a phone that walked into a tunnel
// never says goodbye, and without this its entry lingers until the process exits.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const alive = (ws as WebSocket & { isAlive?: boolean }).isAlive;
    if (alive === false) {
      leaveAll(ws);
      ws.terminate();
      continue;
    }
    (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref();

wss.on("connection", (ws) => {
  (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  ws.on("pong", () => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  });
});
