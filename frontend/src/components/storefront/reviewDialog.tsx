"use client";

import { useState } from "react";
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
import { Star } from "lucide-react";

interface OrderItem {
  productId: string;
  title: string;
  quantity: number;
}

interface ReviewDialogProps {
  orderId: string;
  items?: OrderItem[];
  trigger: React.ReactNode;
  onSuccess?: () => void;
}

export default function ReviewDialog({
  orderId,
  items = [],
  trigger,
  onSuccess,
}: ReviewDialogProps) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string>(
    items.length > 0 ? items[0].productId : ""
  );
  const [rating, setRating] = useState<number>(5);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) {
      toast.error("Please select a product");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/reviews/${productId}`, {
        method: "POST",
        body: JSON.stringify({ rating, body }),
        headers: { "Content-Type": "application/json" },
      });
      toast.success("Review submitted");
      setOpen(false);
      setBody("");
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Write a review</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {items.length > 0 && (
            <div className="space-y-2">
              <Label>Product</Label>
              <Select
                value={productId}
                onValueChange={(value) => {
                  setProductId(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item, idx) => (
                    <SelectItem key={idx} value={item.productId}>
                      {item.title} (x{item.quantity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="focus:outline-none"
                >
                  <Star
                    className={`h-6 w-6 ${
                      star <= rating
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-gray-300"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Review</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Share your experience..."
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Submitting..." : "Submit review"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
