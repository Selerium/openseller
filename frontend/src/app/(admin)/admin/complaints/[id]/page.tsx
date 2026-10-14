"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import Container from "@/components/layout/container";
import ComplaintThread, {
  type OlderPage,
  type ThreadComplaint,
  type ThreadMessage,
} from "@/components/complaints/complaintThread";
import { useLiveReload } from "@/components/complaints/useLiveReload";
import {
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusLabel,
} from "@/lib/order-status";

interface ComplaintDetail extends ThreadComplaint {
  orderId: string;
  orderItemId: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  guestEmail: string | null;
  profile: { id: string; name: string; user: { email: string } | null } | null;
  order: {
    id: string;
    number: number;
    status: string;
    payment: string;
    currency: string;
    subtotalCents: number;
    discountCode: string | null;
    discountCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    guestEmail: string | null;
    createdAt: string;
    items: Array<{
      id: string;
      title: string;
      variantName: string | null;
      quantity: number;
      unitPriceCents: number;
    }>;
    events: Array<{
      id: string;
      type: string;
      note: string | null;
      adminOnly: boolean;
      createdAt: string;
    }>;
  };
}

function statusVariant(status: string): "default" | "outline" | "secondary" {
  if (status === "OPEN") return "default";
  if (status === "RESOLVED") return "secondary";
  return "outline";
}

function ComplaintStatusActions({
  complaint,
  onChanged,
}: {
  complaint: ComplaintDetail;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState(complaint.resolution ?? "");

  useEffect(() => {
    setResolution(complaint.resolution ?? "");
  }, [complaint.id, complaint.resolution]);

  async function move(
    status: "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED" | "OPEN",
    includeResolution: boolean,
  ) {
    setBusy(true);
    try {
      const res = await api(`/admin/complaints/${complaint.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(includeResolution && resolution.trim()
            ? { resolution: resolution.trim() }
            : {}),
        }),
      });
      // The PATCH answer carries no thread, so the page re-reads rather than swapping it
      // in: swapping would wipe the messages this view just rendered.
      onChanged(res.message || `Complaint ${status.toLowerCase()}`);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not update the complaint");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2">
        <Label htmlFor="resolution">Resolution note (shown to the customer)</Label>
        <Textarea
          id="resolution"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="What was decided, refunded, replaced…"
          disabled={busy}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {complaint.status === "OPEN" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void move("ACKNOWLEDGED", false)}
          >
            Acknowledge
          </Button>
        )}
        {(complaint.status === "RESOLVED" || complaint.status === "DISMISSED") ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void move("OPEN", false)}
          >
            Reopen
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void move("RESOLVED", true)}
            >
              Mark as resolved
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void move("DISMISSED", true)}
            >
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ComplaintDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [complaint, setComplaint] = useState<ComplaintDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api<ComplaintDetail>(`/admin/complaints/${id}`);
    setComplaint(res.data);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    load().catch(() => {}).finally(() => setLoading(false));
  }, [id, load]);

  // Live thread: the customer's replies re-read the page as they arrive, timeline
  // included. Draft text is safe — the reply box owns its state.
  useLiveReload([`complaint:${id}`], () => {
    void load();
  });

  async function sendReply(body: string) {
    await api(`/admin/complaints/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    // Re-read: the thread below must show the words the server actually stored rather
    // than an optimistic copy.
    await load();
  }

  async function loadOlder(beforeId: string): Promise<OlderPage> {
    const res = await api<{ items: ThreadMessage[]; hasMore: boolean }>(
      `/admin/complaints/${id}/messages?before=${encodeURIComponent(beforeId)}&limit=20`,
    );
    return { messages: res.data.items, hasMore: res.data.hasMore };
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!complaint) {
    return (
      <Container className="max-w-6xl p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Complaint not found</p>
            <Button asChild className="mt-4">
              <Link href="/admin/complaints">Back to complaints</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );
  }

  const customerEmail = complaint.profile?.user?.email ?? complaint.guestEmail ?? "no email";

  return (
    <Container className="max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">
            Complaint • Order #{complaint.order.number}
          </h1>
          <Badge variant={statusVariant(complaint.status)}>{complaint.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/orders/${complaint.order.id}`}>Open order</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/complaints">Back to complaints</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* The order this dispute hangs off: what was bought, for how much. */}
          <Card>
            <CardHeader>
              <CardTitle>
                Order #{complaint.order.number} • {customerEmail}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge className={orderStatusBadgeClass(complaint.order.status)}>
                  {orderStatusLabel(complaint.order.status)}
                </Badge>
                <Badge variant="outline">
                  {paymentStatusLabel(complaint.order.payment)}
                </Badge>
                <span className="text-muted-foreground">
                  {new Date(complaint.order.createdAt).toLocaleString()}
                </span>
              </div>
              <ul className="space-y-2 text-sm">
                {complaint.order.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3">
                    <span>
                      {item.title}
                      {item.variantName && (
                        <span className="text-muted-foreground"> • {item.variantName}</span>
                      )}
                      <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                        ×{item.quantity}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(
                        item.unitPriceCents * item.quantity,
                        complaint.order.currency,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">
                    {formatMoney(complaint.order.subtotalCents, complaint.order.currency)}
                  </dd>
                </div>
                {complaint.order.discountCents > 0 && (
                  <div className="flex justify-between text-green-700 dark:text-green-400">
                    <dt>
                      Discount
                      {complaint.order.discountCode ? ` (${complaint.order.discountCode})` : ""}
                    </dt>
                    <dd className="tabular-nums">
                      −{formatMoney(complaint.order.discountCents, complaint.order.currency)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">
                    {formatMoney(complaint.order.totalCents, complaint.order.currency)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Own scroll so a long order history never pushes the complaint card — the
                  reason this page exists — below the fold. */}
              <div className="max-h-80 overflow-y-auto pr-1">
              <ol className="space-y-4">
                {complaint.order.events.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm">
                        {event.note ?? event.type}
                        {event.adminOnly && (
                          <Badge variant="outline" className="ml-2">
                            admin only
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{event.type}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
              </div>
            </CardContent>
          </Card>

          {/* The dispute itself, below the timeline: description, thread, reply, resolve. */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>
                Complaint • {complaint.reason.replace(/_/g, " ")}
              </CardTitle>
              <Badge variant={statusVariant(complaint.status)}>{complaint.status}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <ComplaintThread
                complaint={complaint}
                viewer="admin"
                onSend={sendReply}
                loadOlder={loadOlder}
              />
              <div className="border-t border-border pt-4">
                <ComplaintStatusActions
                  complaint={complaint}
                  onChanged={(message) => {
                    toast.success(message);
                    void load();
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">
                {complaint.profile?.name ?? "Guest checkout"}
              </p>
              <p className="text-muted-foreground">{customerEmail}</p>
              <p className="text-muted-foreground">
                Filed {new Date(complaint.createdAt).toLocaleString()}
              </p>
              {complaint.resolvedAt && (
                <p className="text-muted-foreground">
                  Resolved {new Date(complaint.resolvedAt).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Container>
  );
}

export default function AdminComplaintDetailRoute() {
  return (
    <AuthGate>
      <ComplaintDetailPage />
    </AuthGate>
  );
}
