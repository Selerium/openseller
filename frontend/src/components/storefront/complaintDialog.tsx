"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

interface ComplaintDialogProps {
  orderId: string;
  orderItemId?: string | null;
  trigger: React.ReactNode;
  onSuccess?: () => void;
}

export default function ComplaintDialog({
  orderId,
  orderItemId,
  trigger,
  onSuccess,
}: ComplaintDialogProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reasons, setReasons] = useState<any[]>([]);
  const [existing, setExisting] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      api<any>("/complaints/reasons").catch(() => ({ data: [] })),
      api<any>("/complaints").catch(() => ({ data: { items: [] } })),
    ])
      .then(([rRes, cRes]) => {
        const reasonList = rRes?.data || [];
        setReasons(Array.isArray(reasonList) ? reasonList : []);
        const items = (cRes as any)?.data?.items || (cRes as any)?.items || [];
        const found = (items as any[]).find(
          (c: any) => c.orderId === orderId || c.order?.id === orderId
        );
        setExisting(found || null);
      })
      .finally(() => setLoading(false));
  }, [open, orderId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (existing) {
      toast.error("A complaint already exists for this order");
      return;
    }
    if (!reason || !details) {
      toast.error("Please select reason and add details");
      return;
    }
    setSubmitting(true);
    try {
      const guestToken = sessionStorage.getItem("guestToken");
      const headers: Record<string, string> = {};
      if (guestToken) headers["x-guest-token"] = guestToken;
      const payload: any = { reason, details };
      if (orderItemId) payload.orderItemId = orderItemId;
      await api(`/complaints/${orderId}`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers,
      });
      toast.success("Complaint submitted");
      setOpen(false);
      setReason("");
      setDetails("");
      onSuccess?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit complaint");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>File a complaint</DialogTitle>
        </DialogHeader>
        {existing ? (
          <div className="space-y-4">
            <div className="rounded-md border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">Complaint already submitted</p>
                <Badge>{existing.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {existing.reason} • {existing.details}
              </p>
              {existing.resolution && (
                <p className="text-sm">Resolution: {existing.resolution}</p>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {(reasons.length > 0 ? reasons : []).map((r: any) => {
                    const val = r.label || r.reason || r;
                    const label = r.label || String(val).replace(/_/g, " ");
                    return (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Details</Label>
              <Textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                placeholder="Describe the issue..."
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Submitting..." : "Submit complaint"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
