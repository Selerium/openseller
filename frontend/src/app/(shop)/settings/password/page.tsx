"use client";

import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
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

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

type PasswordFormData = z.infer<typeof passwordSchema>;

/**
 * Split from the exported wrapper below so the gate sits above the component, not above its JSX:
 * mounted inside the gate, no password request is ever issued without a session.
 */
function ChangePasswordPage() {
  const [saving, setSaving] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  async function onSubmit(data: PasswordFormData) {
    setSaving(true);

    try {
      await idem.run((idempotencyKey) =>
        api("/profile/password", {
          method: "PUT",
          body: JSON.stringify(data),
          idempotencyKey,
        })
      );
      toast.success("Password updated successfully.");
      methods.reset();
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccountShell section={settingsSection()}>
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            You stay signed in on this device after changing it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit(onSubmit)}
              className="flex max-w-md flex-col gap-4"
            >
              <FormField
                name="currentPassword"
                label="Current Password"
                type="password"
                autoComplete="current-password"
              />

              <FormField
                name="newPassword"
                label="New Password"
                type="password"
                minLength={8}
                autoComplete="new-password"
              />

              <Button type="submit" className="self-start" disabled={saving}>
                {saving ? <Spinner /> : "Update Password"}
              </Button>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </AccountShell>
  );
}

export default function ChangePasswordRoute() {
  return (
    <AuthGate>
      <ChangePasswordPage />
    </AuthGate>
  );
}
