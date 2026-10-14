"use client";

import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import FormField from "@/components/form/formField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(data: ResetPasswordFormData) {
    setLoading(true);

    try {
      await idem.run((idempotencyKey) =>
        api("/reset-password", {
          method: "POST",
          body: JSON.stringify({ token, password: data.password }),
          idempotencyKey,
        })
      );
      toast.success("Your password has been updated.");
      setSuccess(true);
    } catch (err: any) {
      toast.error(err.message || "Reset failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-destructive">Invalid Link</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <p>No reset token found. Please request a new reset link.</p>
          <Button asChild>
            <Link href="/forgot-password">Forgot Password</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-emerald-600 dark:text-emerald-400">
            Password Reset
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <p>Your password has been updated.</p>
          <Button asChild>
            <Link href="/login">Log In</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Reset Password</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <FormProvider {...methods}>
          <form
            onSubmit={methods.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              name="password"
              label="New Password"
              type="password"
              minLength={8}
              autoComplete="new-password"
            />

            <FormField
              name="confirmPassword"
              label="Confirm Password"
              type="password"
              minLength={8}
              autoComplete="new-password"
            />

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Spinner /> : "Reset Password"}
            </Button>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={<Spinner className="size-6" />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
