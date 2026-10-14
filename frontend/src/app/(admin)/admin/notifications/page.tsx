"use client";

import AuthGate from "@/components/auth-gate";
import { useAuth } from "@/lib/auth-context";
import { Spinner } from "@/components/ui/spinner";
import Container from "@/components/layout/container";
import NotificationsInbox from "@/components/notifications/notificationsInbox";

/**
 * Support's inbox: new complaints, customer replies, fresh reviews. Rows link to the
 * complaint or product they are about, so triage starts here.
 */
function AdminNotificationsPage() {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <Container className="max-w-2xl p-6">
      <h1 className="mb-1 text-3xl font-bold">Notifications</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Complaints, replies and reviews, as they arrive.
      </p>
      <NotificationsInbox profileId={user.id} />
    </Container>
  );
}

export default function AdminNotificationsRoute() {
  return (
    <AuthGate>
      <AdminNotificationsPage />
    </AuthGate>
  );
}
