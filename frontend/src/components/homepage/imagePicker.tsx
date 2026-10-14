"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { newUuid } from "@/lib/idempotency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

/**
 * Image field with both routes into it: paste a URL, or upload a file and have the URL filled
 * in from the server.
 *
 * The URL stays editable after an upload because pointing at an asset the admin already has
 * is a normal thing to want, and because the upload response is the only thing that knows the
 * address — the file input alone would leave no way to move the image somewhere else later.
 *
 * Uploads go through POST /admin/uploads, which returns a same-origin `/uploads/...` path;
 * that path is what gets stored, so the homepage keeps working if the domain ever changes.
 */
export default function ImagePicker({
  value,
  onChange,
  label = "Image",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      // The endpoint's field name is "files", and it is an array even for a single file.
      body.append("files", file);
      const res = await api<{ url: string }[]>("/admin/uploads", {
        method: "POST",
        body,
        // A fresh key per chosen file: each selection is its own intent, and reusing one would
        // hand back the first upload's URL for a second, different file.
        idempotencyKey: newUuid(),
      });

      const uploaded = res.data?.[0]?.url;
      if (!uploaded) throw new Error("The upload did not return an image address");
      onChange(uploaded);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that image");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://… or /uploads/…"
          aria-label={label}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? <Spinner className="size-4" /> : <Upload className="size-4" />}
          Upload
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset first: re-choosing the same file must fire change again, which it will
            // not do unless the value is cleared.
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>

      {value && (
        <img
          src={value}
          alt=""
          // The field is typed by hand as often as it is picked, so a bad URL is normal input
          // rather than an error worth shouting about — the preview simply steps aside.
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          className="h-16 w-16 rounded-md border bg-muted object-cover"
        />
      )}
    </div>
  );
}
