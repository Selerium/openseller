"use client";

import AuthGate from "@/components/auth-gate";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui/spinner";
import Container from "@/components/layout/container";
import NotificationsInbox from "@/components/notifications/notificationsInbox";

/**
 * The shopper's inbox: order status and payment updates, complaint replies and
 * resolutions. Linked from the header bell; rows link back to the order they are about.
 */
function NotificationsPage() {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <Container className="max-w-2xl py-6">
      <h1 className="font-heading text-2xl font-medium">Notifications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Order updates, complaint replies and resolutions.
      </p>
      <div className="mt-6">
        <NotificationsInbox profileId={user.id} />
      </div>
    </Container>
  );
}

export default function NotificationsRoute() {
  return (
    <AuthGate>
      <NotificationsPage />
    </AuthGate>
  );
}
