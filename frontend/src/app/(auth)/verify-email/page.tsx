"use client";

import { api } from "@/lib/api";
import { useIdempotency, useFixedIdempotencyKey } from "@/lib/idempotency";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * Why an expired link gets its own recovery form rather than a "try again" link.
 *
 * The API answers an expired token with 410 and the address it was issued to. Both matter: the
 * status is what distinguishes "your link ran out, here is a new one" from "this link was never
 * valid", which is a dead end with nothing to offer. And because holding the token already
 * proved the reader received mail at that address, echoing it back discloses nothing -- while
 * making them retype it is the step most likely to be abandoned. The old copy told them to
 * register again, which for someone who had just changed their address is impossible: the
 * account exists under the new address, so registering collides with itself.
 */
type Outcome =
  | { kind: "loading" }
  | { kind: "verified" }
  | { kind: "expired"; email: string }
  | { kind: "invalid"; message: string };

/** Reads the API's error payload, which AppError populates and errorHandler passes through. */
function errorShape(err: unknown): { status?: number; message: string; data?: any } {
  const e = err as { status?: number; message?: string; data?: any };
  return { status: e?.status, message: e?.message || "", data: e?.data };
}

function ResendForm({ email, onSent }: { email: string; onSent: () => void }) {
  const [address, setAddress] = useState(email);
  const [sending, setSending] = useState(false);
  // Its own key, distinct from the verify call's: resending is a different intent, and sharing a
  // key would make the resend a replay of the verification.
  const idem = useIdempotency();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);

    try {
      await idem.run((idempotencyKey) =>
        api("/resend-verification", {
          method: "POST",
          body: JSON.stringify({ email: address }),
          idempotencyKey,
        })
      );
      // Uninformative on purpose -- see resendVerification.ts. Phrased as a confirmation rather
      // than a promise so it stays honest about the case where no account matched.
      toast.success("If that address needs verifying, a new link is on its way.");
      onSent();
    } catch (err: unknown) {
      toast.error(errorShape(err).message || "Failed to send a new link");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 border-t border-border pt-4">
      <label htmlFor="resend-email" className="text-sm font-medium">
        Email address
      </label>
      <input
        id="resend-email"
        type="email"
        required
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <Button type="submit" disabled={sending}>
        {sending ? <Spinner /> : "Send a new link"}
      </Button>
    </form>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });
  const [resendSent, setResendSent] = useState(false);
  // One key for the whole page, not one per attempt. This effect fires on mount, and React
  // invokes mount effects twice in dev StrictMode; without a shared key that is two
  // verifications of the same single-use token.
  const idempotencyKey = useFixedIdempotencyKey();

  useEffect(() => {
    if (!token) {
      setOutcome({ kind: "invalid", message: "No verification token provided." });
      return;
    }

    api("/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
      idempotencyKey,
    })
      .then(() => {
        setOutcome({ kind: "verified" });
        toast.success("Email verified successfully!");
      })
      .catch((err: unknown) => {
        const { status, message, data } = errorShape(err);

        if (status === 410 && data?.canResend) {
          setOutcome({ kind: "expired", email: data.email || "" });
          return;
        }

        setOutcome({ kind: "invalid", message: message || "Verification failed." });
        toast.error(message || "Verification failed.");
      });
  }, [token, idempotencyKey]);

  if (outcome.kind === "loading") {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <Spinner className="size-6" />
          <p>Verifying your email...</p>
        </CardContent>
      </Card>
    );
  }

  if (outcome.kind === "verified") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-emerald-600 dark:text-emerald-400">Verified!</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <p>Your email address is confirmed.</p>
          <Button asChild>
            <Link href="/login">Log In</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (outcome.kind === "expired") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-amber-600 dark:text-amber-400">Link expired</CardTitle>
          <CardDescription>
            Verification links last 24 hours. Send yourself a fresh one below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-stretch gap-4">
          {resendSent ? (
            <>
              <p className="text-center text-sm">
                Check {outcome.email} for the new link.
              </p>
              <Button asChild variant="outline">
                <Link href="/login">Back to Login</Link>
              </Button>
            </>
          ) : (
            <ResendForm email={outcome.email} onSent={() => setResendSent(true)} />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-destructive">Verification Failed</CardTitle>
        <CardDescription>{outcome.message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-stretch gap-4">
        <p className="text-center text-sm">
          If this was your first verification, register again. If you changed your address, the
          link may have been replaced by a newer one.
        </p>
        <Button asChild variant="outline">
          <Link href="/login">Back to Login</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={<Spinner className="size-6" />}>
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
