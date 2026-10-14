"use client";

import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import Link from "next/link";
import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import FormField from "@/components/form/formField";
import GuestGate from "@/components/guest-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const registerSchema = z
  .object({
    fullName: z.string().min(1, "Full name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

/**
 * Split from the exported wrapper below so the gate sits above the component, not above its
 * JSX: mounted inside the gate, a signed-in shopper is redirected before the register form ever
 * mounts, rather than filling one in only to be told the address is taken.
 */
function RegisterForm() {
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: RegisterFormData) {
    setLoading(true);

    try {
      await idem.run((idempotencyKey) =>
        api("/register", {
          method: "POST",
          body: JSON.stringify(data),
          idempotencyKey,
        })
      );
      setSuccess(data.email);
    } catch (err: any) {
      toast.error(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">
              We sent a verification link to <strong>{success}</strong>.
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
            <CardTitle className="text-2xl">Create Account</CardTitle>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <form
              onSubmit={methods.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField name="fullName" label="Full Name" />

              <FormField name="email" label="Email" type="email" placeholder="Email" />

              <FormField
                name="password"
                label="Password"
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
                {loading ? <Spinner /> : "Sign Up"}
              </Button>
            </form>

            <p className="text-center text-sm">
              Already have an account?{" "}
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

export default function RegisterPage() {
  return (
    <GuestGate>
      <RegisterForm />
    </GuestGate>
  );
}
