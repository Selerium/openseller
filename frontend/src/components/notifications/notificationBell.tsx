"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useRealtimeChannel } from "@/lib/realtime";
import { Button } from "@/components/ui/button";

/**
 * The header bell: unread count plus a toast the moment something arrives.
 *
 * The count is read over REST (on mount and on every navigation, so visiting the inbox
 * and marking rows read is reflected without a reload) and bumped live off the
 * profile's own `user:<id>` channel. Guests have no inbox and render nothing.
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ unread: number }>("/notifications");
      setUnread(res.data.unread);
    } catch {
      // Signed-out mid-flight, or the inbox is unreachable: the bell simply stays quiet.
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    void refresh();
  }, [user, pathname, refresh]);

  useRealtimeChannel(user ? `user:${user.id}` : null, (event, data) => {
    if (event !== "notification.created" || !data) return;
    setUnread((count) => count + 1);
    const title = typeof data.title === "string" ? data.title : "New notification";
    const link = typeof data.link === "string" ? data.link : null;
    toast.success(title, {
      description:
        typeof data.body === "string" && data.body.length > 0
          ? data.body.slice(0, 120)
          : undefined,
      ...(link
        ? {
            action: {
              label: "View",
              onClick: () => {
                window.location.href = link;
              },
            },
          }
        : {}),
    });
  });

  if (!user) return null;

  const href = user.role === "ADMIN" ? "/admin/notifications" : "/profile/notifications";

  return (
    <Button variant="ghost" size="icon" className="relative" asChild>
      <Link href={href} aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}>
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-medium text-primary-foreground tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
