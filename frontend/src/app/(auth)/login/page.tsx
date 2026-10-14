"use client";

import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import FormField from "@/components/form/formField";
import GuestGate from "@/components/guest-gate";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const resendSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type ResendFormData = z.infer<typeof resendSchema>;

function LoginForm() {
  const { user, verificationPending } = useAuth();
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // Open by default when we know who is waiting: after an email change the user is still signed
  // in but cannot log in, so landing here at all is the confusing part, and having the address
  // they just chose already in the field is most of the fix. Auto-opening for a signed-in user
  // costs a signed-out visitor nothing, because for them the link stays collapsed.
  const [showResend, setShowResend] = useState(false);
  const searchParams = useSearchParams();
  // Separate keys: logging in and asking for another verification email are different
  // intents, so sharing one would make the second a 422 against the first.
  const loginIdem = useIdempotency();
  const resendIdem = useIdempotency();

  const methods = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const resendMethods = useForm<ResendFormData>({
    resolver: zodResolver(resendSchema),
    defaultValues: { email: "" },
  });

  // Two ways to arrive here needing a fresh link, and they are not the same arrival:
  //
  //   - `user?.email` is known, so the form can be prefilled. Normal case: the shopper changed
  //     their address and is still signed in.
  //   - `verificationPending` with no `user`, which is what AuthGate sends after /me answered
  //     403-unverified. There is no session left to read an address from, so nothing can be
  //     prefilled -- but the form still has to open, because it is the only place on this page
  //     that asks for an address at all, and leaving it collapsed is how a user ends up stuck.
  //
  // The prefill is guarded by a ref rather than by dependency identity: `useForm` hands back a
  // fresh object each render, so listing it alone would re-run this effect more often than the
  // address changes, and setValue would overwrite the field mid-typing. At most once per
  // distinct address instead.
  const prefilledFor = useRef<string | null>(null);

  useEffect(() => {
    if (verificationPending) setShowResend(true);

    const email = user?.email;
    if (!email || prefilledFor.current === email) return;

    prefilledFor.current = email;
    setShowResend(true);
    resendMethods.setValue("email", email);
  }, [user?.email, verificationPending, resendMethods]);

  async function onResend(data: ResendFormData) {
    setResending(true);

    try {
      await resendIdem.run((idempotencyKey) =>
        api("/resend-verification", {
          method: "POST",
          body: JSON.stringify(data),
          idempotencyKey,
        })
      );
      toast.success(
        "If an account exists and isn't verified, a new verification email has been sent."
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to resend verification email");
    } finally {
      setResending(false);
    }
  }

  async function onSubmit(data: LoginFormData) {
    setLoading(true);

    try {
      await loginIdem.run((idempotencyKey) =>
        api("/login", {
          method: "POST",
          body: JSON.stringify(data),
          idempotencyKey,
        })
      );

      // No refreshUser() here, deliberately.
      //
      // It used to sit between the login call and this navigation. Two problems, one cause:
      // populating the auth context makes GuestGate decide this visitor is signed in, and the
      // gate assigns window.location.href too. Both assignments target the same property, so
      // whichever runs last wins, and the order between React's effect flush and this line is
      // scheduler timing rather than anything guaranteed. When the gate won, the `?redirect=`
      // target was silently dropped and the shopper landed on "/" instead of the deep link they
      // were sent to login for — the exact thing the parameter exists to preserve.
      //
      // The call was also dead work: the assignment below is a hard navigation, so every byte of
      // client state is discarded the moment it runs, and the arriving page re-runs
      // AuthProvider's /me fetch from scratch. Nothing was ever read from it.
      const redirect = searchParams.get("redirect");
      if (redirect) {
        window.location.href = redirect;
        return;
      }

      try {
        const me = await api<{ role?: string }>("/me");
        window.location.href = me.data?.role === "ADMIN" ? "/admin/dashboard" : "/marketplace";
      } catch {
        window.location.href = "/profile";
      }
    } catch (err: any) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormProvider {...methods}>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Log In</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <form
            onSubmit={methods.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField name="email" label="Email" type="email" placeholder="Email" />

            <FormField
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
            />

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Spinner /> : "Log In"}
            </Button>
          </form>

          <FieldSeparator className="[&>span]:bg-card">OR</FieldSeparator>

          <Link
            href="/forgot-password"
            className="text-center text-sm text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>

          {!showResend ? (
            <button
              type="button"
              onClick={() => setShowResend(true)}
              className="text-center text-sm text-primary underline-offset-4 hover:underline"
            >
              Resend verification email
            </button>
          ) : (
            <FormProvider {...resendMethods}>
              {/* Not a border + heading: this form is the page's primary action for anyone
                  arriving with an unverified address, which the effect above detects by opening
                  it for them. */}
              <form
                onSubmit={resendMethods.handleSubmit(onResend)}
                className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4"
              >
                <h3 className="text-center text-sm font-semibold">
                  {user?.email
                    ? "Confirm your new address"
                    : "Resend Verification Email"}
                </h3>
                {user?.email && (
                  <p className="text-center text-xs text-muted-foreground">
                    You are signed in, but {user.email} needs confirming before you can log in
                    again.
                  </p>
                )}
                <FormField
                  name="email"
                  label="Email"
                  type="email"
                  placeholder="Email"
                />
                <Button type="submit" className="w-full" disabled={resending}>
                  {resending ? <Spinner /> : "Send Verification Email"}
                </Button>
              </form>
            </FormProvider>
          )}

          <p className="text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-primary underline-offset-4 hover:underline"
            >
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </FormProvider>
  );
}

export default function LoginPage() {
  return (
    // The gate sits above the form, not inside it, so a signed-in shopper is redirected before
    // the login form ever mounts rather than after painting it.
    <GuestGate>
      <div className="flex flex-1 items-center justify-center p-4">
        <Suspense fallback={<Spinner className="size-6" />}>
          <LoginForm />
        </Suspense>
      </div>
    </GuestGate>
  );
}
