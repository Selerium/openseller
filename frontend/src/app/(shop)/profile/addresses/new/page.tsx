"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { addressSchema, emptyAddress } from "@/lib/addresses";
import AddressFormFields from "@/components/address/addressFormFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import Container from "@/components/layout/container";

const schema = addressSchema.extend({
  isDefault: z.boolean().optional().default(false),
});

type NewAddressFormData = z.input<typeof schema>;

function NewAddressPage() {
  const router = useRouter();
  const idem = useIdempotency();
  const [saving, setSaving] = useState(false);

  const methods = useForm<NewAddressFormData>({
    resolver: zodResolver(schema),
    defaultValues: { ...emptyAddress, isDefault: false },
  });

  async function onSubmit(data: NewAddressFormData) {
    setSaving(true);
    try {
      await idem.run((idempotencyKey) =>
        api("/addresses", {
          method: "POST",
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
            isDefault: data.isDefault === true,
          }),
        })
      );
      toast.success("Address saved");
      router.push("/profile/addresses");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not save address");
      setSaving(false);
    }
  }

  return (
    <Container className="max-w-2xl py-6">
      <Card>
        <CardHeader>
          <CardTitle>Add new address</CardTitle>
        </CardHeader>
        <CardContent>
          <FormProvider {...methods}>
            <form onSubmit={methods.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <AddressFormFields showDefaultToggle />
              <p className="text-xs text-muted-foreground">
                Your first address automatically becomes the default.
              </p>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <>
                      <Spinner /> Saving…
                    </>
                  ) : (
                    "Save address"
                  )}
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/profile/addresses">Cancel</Link>
                </Button>
              </div>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function NewAddressRoute() {
  return (
    <AuthGate>
      <NewAddressPage />
    </AuthGate>
  );
}
