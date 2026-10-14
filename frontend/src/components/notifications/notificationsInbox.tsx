"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, BellOff, CheckCheck, MessageSquare, Package, Star } from "lucide-react";
import { api } from "@/lib/api";
import { useRealtimeChannel } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * One inbox, two audiences.
 *
 * Shoppers read order/complaint updates here; admins read complaint/review/message
 * arrivals. The rows are identical in shape — only the links differ, and those come
 * from the server — so both pages render this component and differ only in chrome.
 *
 * New rows arrive over the socket and are prepended live (deduped by id, because the
 * REST read below and the event can interleave); opening a row marks it read.
 */

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function typeIcon(type: string) {
  if (type.startsWith("complaint.message")) return MessageSquare;
  if (type.startsWith("complaint.")) return AlertCircle;
  if (type.startsWith("order.")) return Package;
  if (type.startsWith("review.")) return Star;
  return AlertCircle;
}

export default function NotificationsInbox({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api<{ items: NotificationItem[]; unread: number }>(
      "/notifications",
    );
    setItems(res.data.items);
  }, []);

  useEffect(() => {
    load().catch(() => {}).finally(() => setLoading(false));
  }, [load]);

  // Live: rows pushed while the page is open prepend without a refresh.
  useRealtimeChannel(`user:${profileId}`, (event, data) => {
    if (event !== "notification.created" || !data || typeof data.id !== "string") return;
    const incoming = data as NotificationItem;
    setItems((prev) =>
      prev.some((item) => item.id === incoming.id) ? prev : [incoming, ...prev],
    );
  });

  async function markAllRead() {
    try {
      await api("/notifications", { method: "PATCH", body: JSON.stringify({}) });
      setItems((prev) =>
        prev.map((item) =>
          item.readAt ? item : { ...item, readAt: new Date().toISOString() },
        ),
      );
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not mark as read");
    }
  }

  async function markOneRead(id: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id && !item.readAt
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    try {
      await api("/notifications", {
        method: "PATCH",
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // Already marked locally; a failed write converges on the next load.
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  const unreadCount = items.filter((item) => !item.readAt).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {unreadCount === 0
            ? "You're all caught up."
            : `${unreadCount} unread`}
        </p>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="size-3.5" />
            Mark all as read
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <BellOff className="size-6 text-muted-foreground" />
            <p className="text-muted-foreground">No notifications yet.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const Icon = typeIcon(item.type);
            const row = (
              <li
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border p-3 transition-colors",
                  !item.readAt && "border-primary/40 bg-primary/5",
                  item.link && "hover:border-primary/50",
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !item.readAt && "font-medium")}>
                    {item.title}
                  </p>
                  {item.body && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {item.body}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                {!item.readAt && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                )}
              </li>
            );
            return item.link ? (
              <Link
                key={item.id}
                href={item.link}
                onClick={() => void markOneRead(item.id)}
                className="block"
              >
                {row}
              </Link>
            ) : (
              <div key={item.id} onClick={() => void markOneRead(item.id)}>
                {row}
              </div>
            );
          })}
        </ul>
      )}
    </div>
  );
}
