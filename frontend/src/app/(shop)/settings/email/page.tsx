"use client";

import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import FormField from "@/components/form/formField";
import AuthGate from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import AccountShell from "@/components/layout/accountShell";
import { settingsSection } from "@/components/layout/account-nav";

const emailSchema = z.object({
  newEmail: z.string().email("Invalid email address"),
  emailPassword: z.string().min(1, "Password is required"),
});

type EmailFormData = z.infer<typeof emailSchema>;

/**
 * Split from the exported wrapper below so the gate sits above the component, not above its JSX:
 * mounted inside the gate, no email request is ever issued without a session.
 *
 * The address on the card is the one in session, not one passed in: after a successful change
 * the user is no longer verified (the API revokes it and mails the new address), so
 * refreshUser() has to run or the header would keep showing an address the account no longer
 * has, and AuthGate would let a signed-out-of-verification user through as if all were well.
 */
function ChangeEmailPage() {
  const { refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
    defaultValues: { newEmail: "", emailPassword: "" },
  });

  async function onSubmit(data: EmailFormData) {
    setSaving(true);

    try {
      const res = await idem.run((idempotencyKey) =>
        api<{ email: string; emailVerified: boolean }>("/profile/email", {
          method: "PUT",
          body: JSON.stringify({
            currentPassword: data.emailPassword,
            newEmail: data.newEmail,
          }),
          idempotencyKey,
        })
      );

      toast.success(res.message || "Email updated successfully.");
      methods.reset();
      await refreshUser();
    } catch (err: any) {
      toast.error(err.message || "Failed to update email");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccountShell section={settingsSection()}>
      <Card>
        <CardHeader>
          <CardTitle>Change Email</CardTitle>
          <CardDescription>
            We will email a verification link to the new address. Your sign-in stops working
            until it is confirmed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit(onSubmit)}
              className="flex max-w-md flex-col gap-4"
            >
              <FormField
                name="newEmail"
                label="New Email"
                type="email"
                placeholder="Email"
              />

              <FormField
                name="emailPassword"
                label="Current Password"
                type="password"
                autoComplete="current-password"
              />

              <Button type="submit" className="self-start" disabled={saving}>
                {saving ? <Spinner /> : "Update Email"}
              </Button>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </AccountShell>
  );
}

export default function ChangeEmailRoute() {
  return (
    <AuthGate>
      <ChangeEmailPage />
    </AuthGate>
  );
}
