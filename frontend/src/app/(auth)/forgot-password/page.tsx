"use client";

import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import Link from "next/link";
import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import FormField from "@/components/form/formField";
import GuestGate from "@/components/guest-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

/**
 * Split from the exported wrapper below so the gate sits above the component rather than around
 * its JSX: a signed-in shopper is redirected before this form ever mounts.
 *
 * The sibling pages in this group that carry a token — reset-password, verify-email — are
 * deliberately NOT gated, because their whole purpose is to work from an emailed link that the
 * recipient may well open while already signed in. See the note on GuestGate.
 */
function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(data: ForgotPasswordFormData) {
    setLoading(true);

    try {
      await idem.run((idempotencyKey) =>
        api("/forgot-password", {
          method: "POST",
          body: JSON.stringify(data),
          idempotencyKey,
        })
      );
    } catch {
      // Backend always returns 200 to prevent enumeration
    } finally {
      setSubmitted(true);
      setLoading(false);
    }
  }

  if (submitted) {
    const email = methods.getValues("email");
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">
              If an account exists for <strong>{email}</strong>, we sent a
              password reset link.
            </p>
            <Button asChild>
              <Link href="/login">Back to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <FormProvider {...methods}>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Forgot Password</CardTitle>
            <p className="text-center text-muted-foreground">
              Enter your email and we&apos;ll send you a reset link.
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <form
              onSubmit={methods.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField name="email" label="Email" type="email" placeholder="Email" />

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Spinner /> : "Send Reset Link"}
              </Button>
            </form>

            <p className="text-center text-sm">
              Remember your password?{" "}
              <Link
                href="/login"
                className="text-primary underline-offset-4 hover:underline"
              >
                Log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </FormProvider>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <GuestGate>
      <ForgotPasswordForm />
    </GuestGate>
  );
}
