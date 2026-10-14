"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { addressSchema, toFormData, type SavedAddress } from "@/lib/addresses";
import AddressFormFields from "@/components/address/addressFormFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import Container from "@/components/layout/container";

const schema = addressSchema.extend({
  isDefault: z.boolean().optional().default(false),
});

type EditAddressFormData = z.input<typeof schema>;

function EditAddressPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as string;
  const router = useRouter();
  const idem = useIdempotency();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isCurrentlyDefault, setIsCurrentlyDefault] = useState(false);

  const methods = useForm<EditAddressFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: "Home",
      recipientName: "",
      line1: "",
      line2: "",
      city: "",
      region: "",
      postalCode: "",
      countryCode: "",
      phone: "",
      isDefault: false,
    },
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api<SavedAddress[]>(`/addresses`)
      .then((res) => {
        if (cancelled) return;
        const found = res.data.find((a) => a.id === id);
        if (!found) {
          setNotFound(true);
          return;
        }
        setIsCurrentlyDefault(found.isDefault);
        methods.reset({ ...toFormData(found), isDefault: found.isDefault });
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSubmit(data: EditAddressFormData) {
    setSaving(true);
    try {
      await idem.run((idempotencyKey) =>
        api(`/addresses/${id}`, {
          method: "PATCH",
          idempotencyKey,
          body: JSON.stringify({
            label: (data.label ?? "").trim() || "Home",
            recipientName: data.recipientName.trim(),
            line1: data.line1.trim(),
            line2: data.line2.trim() || null,
            city: data.city.trim(),
            region: data.region.trim() || null,
            postalCode: data.postalCode.trim() || null,
            countryCode: data.countryCode.trim().toUpperCase(),
            phone: data.phone.trim() || null,
            // Only send a promotion; unsetting the default is a no-op server-side
            // (another address must be promoted instead), so sending false would
            // be misleading.
            ...(data.isDefault === true && !isCurrentlyDefault
              ? { isDefault: true }
              : {}),
          }),
        })
      );
      toast.success("Address updated");
      router.push("/profile/addresses");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not update address");
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!window.confirm("Delete this address?")) return;
    setDeleting(true);
    try {
      await api(`/addresses/${id}`, { method: "DELETE" });
      toast.success("Address deleted");
      router.push("/profile/addresses");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not delete address");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (notFound) {
    return (
      <Container className="max-w-2xl py-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Address not found.</p>
            <Button asChild className="mt-4">
              <Link href="/profile/addresses">Back to addresses</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="max-w-2xl py-6">
      <Card>
        <CardHeader>
          <CardTitle>Edit address</CardTitle>
        </CardHeader>
        <CardContent>
          <FormProvider {...methods}>
            <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <AddressFormFields showDefaultToggle={!isCurrentlyDefault} />
              {isCurrentlyDefault && (
                <p className="text-xs text-muted-foreground">
                  This is your default address. Save another address as default to change it.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || deleting}>
                  {saving ? (
                    <>
                      <Spinner /> Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/profile/addresses">Cancel</Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={saving || deleting}
                  onClick={onDelete}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function EditAddressRoute() {
  return (
    <AuthGate>
      <EditAddressPage />
    </AuthGate>
  );
}
