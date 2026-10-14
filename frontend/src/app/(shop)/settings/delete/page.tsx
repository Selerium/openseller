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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AccountShell from "@/components/layout/accountShell";
import { settingsSection } from "@/components/layout/account-nav";

const deleteSchema = z.object({
  currentPassword: z.string().min(1, "Password is required"),
});

type DeleteFormData = z.infer<typeof deleteSchema>;

/**
 * Split from the exported wrapper below so the gate sits above the component, not above its JSX.
 */
function DeleteAccountPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<DeleteFormData>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { currentPassword: "" },
  });

  async function onConfirm(data: DeleteFormData) {
    setDeleting(true);

    try {
      await idem.run((idempotencyKey) =>
        api("/account/delete", {
          method: "DELETE",
          body: JSON.stringify({ currentPassword: data.currentPassword }),
          idempotencyKey,
        })
      );

      // The API has already cleared the auth cookies. A full navigation rather than a router
      // push: the account is gone, so the client-side session is meaningless and every cached
      // page still holds the old user's name.
      window.location.href = "/";
    } catch (err: any) {
      toast.error(err.message || "Failed to delete your account");
      setDeleting(false);
      methods.setError("currentPassword", {
        message: err.message || "Failed to delete your account",
      });
    }
  }

  // The API refuses to delete an administrator, so do not offer it and take them to a 403.
  const isAdmin = user?.role === "ADMIN";

  return (
    <AccountShell section={settingsSection()}>
      <Card>
        <CardHeader>
          <CardTitle>Delete Account</CardTitle>
          <CardDescription>
            Permanently removes your account and everything in it. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <p className="text-sm text-muted-foreground">
              Administrator accounts cannot be deleted from here.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Your saved addresses, reviews and cards are deleted with it. Past orders are kept
                for our records but are no longer linked to you.
              </p>
              <Button variant="destructive" onClick={() => setOpen(true)}>
                Delete my account
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Closing mid-request would leave the dialog's spinner gone while the delete is still
          // in flight, so the open state is not allowed to change until it settles.
          if (deleting) return;
          setOpen(next);
          if (!next) methods.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account, addresses and saved cards. Enter your
              password to confirm.
            </DialogDescription>
          </DialogHeader>

          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit(onConfirm)}
              className="flex flex-col gap-4"
            >
              <FormField
                name="currentPassword"
                label="Current Password"
                type="password"
                autoComplete="current-password"
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={deleting}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={deleting}>
                  {deleting ? <Spinner /> : "Delete permanently"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        </DialogContent>
      </Dialog>
    </AccountShell>
  );
}

export default function DeleteAccountRoute() {
  return (
    <AuthGate>
      <DeleteAccountPage />
    </AuthGate>
  );
}
