"use client";

/**
 * Checkout.
 *
 * The step between the cart and the payment page, and the only place in the storefront that knows
 * who is buying and where the order goes. Both are mandatory at the API: POST /checkout/session
 * refuses a request with no email (`validator.isEmail`, guests have no account to fall back on) and
 * with no shipping address (`parseAddressInput` throws "A shipping address is required"). Neither
 * can come from the cart, which is a per-browser list of `variantId` and `quantity` and nothing
 * else — which is why the cart routes here instead of calling the endpoint itself.
 *
 * Prices shown here are the cart's own. They are re-read from the catalog on mount and re-derived
 * from the database again inside the endpoint, so the summary is a statement of intent, not a
 * quote. If the two disagree the order is created at the database's figure, which is why a
 * repriced line is worth a re-check before the shopper commits.
 *
 * The cart is *not* cleared here. Payment can still be abandoned after this form is submitted —
 * that is the whole point of the cancelled page — so the order is only confirmed by the signed
 * webhook (or the mock confirm), and the success page clears the cart when it sees them.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { PackageOpen, TriangleAlert } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { formatMoney } from "@/lib/money";

import FormField from "@/components/form/formField";
import CountrySelector from "@/components/form/countrySelector";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import Container from "@/components/layout/container";

/**
 * Mirrors the limits in backend/src/lib/address.ts.
 *
 * Duplicated rather than imported because those are two separate deployables with no shared
 * package. Matching them here means an over-long value is refused in the form instead of costing a
 * round trip to be refused with the same message.
 */
const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  recipientName: z.string().min(1, "Recipient name is required").max(120),
  line1: z.string().min(1, "Address line 1 is required").max(200),
  line2: z.string().max(200),
  city: z.string().min(1, "City is required").max(100),
  region: z.string().max(100),
  postalCode: z.string().max(24),
  countryCode: z
    .string()
    .min(1, "Country is required")
    .length(2, "Country must be a 2-letter ISO code"),
  phone: z.string().max(32),
});

type CheckoutFormData = z.infer<typeof schema>;

interface SavedAddress {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
}

/** The `data` half of POST /checkout/session's 201. */
interface CheckoutSession {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  currency: string;
  mock: boolean;
  /** One-time proof of ownership for a guest order. Never returned again. */
  guestToken: string | null;
  /** Stripe's hosted page, or the local mock confirm. Either way, leave the app. */
  redirectUrl: string;
}

function CheckoutContent() {
  const { user, loading: authLoading } = useAuth();
  const { lines, issues, hydrated, reconcile } = useCart();
  const idem = useIdempotency();

  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const methods = useForm<CheckoutFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      recipientName: "",
      line1: "",
      line2: "",
      city: "",
      region: "",
      postalCode: "",
      countryCode: "",
      phone: "",
    },
  });
  const { reset } = methods;

  // Re-read the catalog once the cart is readable, so the summary is not quoting figures the
  // shopper left on a page ten minutes ago. Guarded on `cancelled` rather than on the cart
  // version, because clearing `checking` is what keeps the submit button live: an extra guard here
  // would leave the button stuck on "Checking availability…" if the cart moved mid-request.
  useEffect(() => {
    if (!hydrated || lines.length === 0) return;

    let cancelled = false;

    setChecking(true);
    reconcile()
      .catch(() => {
        // A failed re-read is not a failed cart. The lines render with whatever they last knew,
        // and the endpoint re-prices from the database regardless.
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Prefill from the signed-in shopper's own details, once. Guarded by a ref rather than by the
  // effect's dependencies because it is a one-shot: a later `lines` change, or any other render
  // that produces a fresh `user` object, must not stomp on a half-typed address.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!user || prefilled.current) return;
    prefilled.current = true;

    reset({ email: user.email ?? "" });

    // The address book is behind the authenticated router, so this only ever runs for a shopper
    // with a session. A failure here is not an error: the form is empty and perfectly usable.
    void api<SavedAddress[]>("/addresses")
      .then((res) => {
        // The API returns the default first, but asking explicitly keeps this correct if that
        // ordering is ever changed.
        const preferred =
          res.data.find((address) => address.isDefault) ?? res.data[0];
        if (!preferred) return;

        reset({
          email: user.email ?? "",
          recipientName: preferred.recipientName,
          line1: preferred.line1,
          line2: preferred.line2 ?? "",
          city: preferred.city,
          region: preferred.region ?? "",
          postalCode: preferred.postalCode ?? "",
          countryCode: preferred.countryCode,
          phone: preferred.phone ?? "",
        });
      })
      .catch(() => {});
  }, [user, reset]);

  const blocked = lines.filter((line) => line.variantId in issues);
  const payable = lines.filter((line) => !(line.variantId in issues));

  const currency = payable[0]?.currency ?? lines[0]?.currency ?? "usd";
  const subtotalCents = payable.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0
  );

  // Blocking on `blocked` rather than clearing those issues, which is what the old stub did:
  // clearing them here would let the shopper pay for a line that is no longer buyable, and the
  // endpoint would answer 409 anyway.
  const canSubmit = payable.length > 0 && blocked.length === 0 && !checking;

  async function onSubmit(data: CheckoutFormData) {
    setSubmitting(true);

    // Optional fields are sent as null rather than "": the backend's `optionalString` treats both
    // as absent, but null is what it stores, so an empty string would round-trip into the order
    // snapshot as a blank line instead of nothing.
    const emptyToNull = (value: string) => value.trim() || null;

    try {
      const res = await idem.run((idempotencyKey) =>
        api<CheckoutSession>("/checkout/session", {
          method: "POST",
          idempotencyKey,
          body: JSON.stringify({
            items: payable.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
            })),
            email: data.email.trim().toLowerCase(),
            shippingAddress: {
              recipientName: data.recipientName.trim(),
              line1: data.line1.trim(),
              line2: emptyToNull(data.line2),
              city: data.city.trim(),
              region: emptyToNull(data.region),
              postalCode: emptyToNull(data.postalCode),
              countryCode: data.countryCode.trim().toUpperCase(),
              phone: emptyToNull(data.phone),
            },
            // No billingAddress: it is optional, and for a card payment Stripe collects whatever
            // the card requires and puts it on the receipt regardless of what we sent.
          }),
        })
      );

      // Written before navigating. sessionStorage survives a cross-document load in the same tab,
      // which is what makes the token still readable on the other side of the Stripe redirect —
      // the mock confirm and the success page both read it back from here.
      if (res.data.guestToken) {
        sessionStorage.setItem("guestToken", res.data.guestToken);
      }

      // A full document navigation, not router.push: on the Stripe path `redirectUrl` points at
      // checkout.stripe.com, an origin the Next router cannot route to. Assigning also works for
      // the same-origin mock path, so there is one code path for both.
      window.location.assign(res.data.redirectUrl);
    } catch (error: unknown) {
      // Deliberately not setSubmitting(false) on the way out: a successful call leaves the
      // spinner up while the document unloads.
      setSubmitting(false);

      const status = (error as { status?: number } | null)?.status;
      const message =
        (error as { message?: string } | null)?.message ||
        "Could not start checkout";

      toast.error(status === 409 ? "Your cart changed" : "Checkout failed", {
        description: message,
      });

      // A 409 is the endpoint's way of saying the cart it re-priced no longer matches the one on
      // screen — an item gone, out of stock, or repriced. Re-reading tells the shopper which, and
      // the blocked-lines notice above takes over from there.
      if (status === 409) {
        try {
          await reconcile();
        } catch {
          // Already surfaced above; a failed refresh changes nothing about that.
        }
      }
    }
  }

  if (authLoading || !hydrated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  // Nothing to buy. A shopper who emptied their cart in another tab, or followed /checkout
  // directly, should not be shown an empty form to fill in.
  if (lines.length === 0) {
    return (
      <Container className="flex flex-col items-center gap-3 py-24 text-center">
        <PackageOpen className="size-8 text-muted-foreground" />
        <h1 className="font-heading text-xl font-medium">Your cart is empty</h1>
        <p className="text-sm text-muted-foreground">
          Add something to your cart before checking out.
        </p>
        <Button className="mt-2" asChild>
          <Link href="/marketplace">Browse the marketplace</Link>
        </Button>
      </Container>
    );
  }

  return (
    <Container className="py-6">
      <h1 className="font-heading text-2xl font-medium">Checkout</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {user
          ? "Confirm where this order should go."
          : "Enter your email and delivery address to continue."}
      </p>

      {blocked.length > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              {blocked.length} item{blocked.length > 1 ? "s" : ""} can no longer be ordered
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {blocked.map((line) => line.title).join(", ")}.{" "}
              <Link href="/cart" className="underline underline-offset-2">
                Edit your cart
              </Link>{" "}
              to remove {blocked.length > 1 ? "them" : "it"}.
            </p>
          </div>
        </div>
      )}

      <FormProvider {...methods}>
        <form
          onSubmit={methods.handleSubmit(onSubmit)}
          className="mt-6 grid gap-8 lg:grid-cols-[1fr_20rem]"
        >
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Contact</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldSet>
                  <FieldLegend variant="label" className="sr-only">
                    Contact
                  </FieldLegend>
                  <FormField
                    name="email"
                    label="Email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </FieldSet>
                <p className="mt-2 text-xs text-muted-foreground">
                  {user
                    ? "Your order confirmation goes to your account email."
                    : "We send the receipt and delivery updates here."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Delivery address</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <FieldSet>
                  <FieldLegend variant="label" className="sr-only">
                    Delivery address
                  </FieldLegend>
                  <FormField
                    name="recipientName"
                    label="Full name"
                    placeholder="Recipient name"
                    autoComplete="name"
                  />

                  <FormField
                    name="line1"
                    label="Address line 1"
                    placeholder="Street address"
                    autoComplete="address-line1"
                  />

                  <FormField
                    name="line2"
                    label="Address line 2 (optional)"
                    placeholder="Apartment, suite, unit"
                    autoComplete="address-line2"
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      name="city"
                      label="City"
                      placeholder="City"
                      autoComplete="address-level2"
                    />
                    <FormField
                      name="region"
                      label="State / region (optional)"
                      placeholder="Region"
                      autoComplete="address-level1"
                    />
                  </div>

                  <CountrySelector name="countryCode" label="Country" />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      name="postalCode"
                      label="Postal code (optional)"
                      placeholder="Postal code"
                      autoComplete="postal-code"
                    />
                    <FormField
                      name="phone"
                      label="Phone (optional)"
                      type="tel"
                      placeholder="Phone number"
                      autoComplete="tel"
                    />
                  </div>
                </FieldSet>
              </CardContent>
            </Card>
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle>Order summary</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {payable.map((line) => (
                    <li
                      key={line.variantId}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="line-clamp-1">{line.title}</span>
                        {line.variantName && (
                          <span className="text-xs text-muted-foreground">
                            {line.variantName}
                          </span>
                        )}
                        <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                          ×{line.quantity}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(line.unitPriceCents * line.quantity, line.currency)}
                      </span>
                    </li>
                  ))}
                </ul>

                <Separator className="my-4" />

                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="tabular-nums">
                      {formatMoney(subtotalCents, currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Shipping</dt>
                    <dd className="text-muted-foreground">Calculated at checkout</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd className="text-muted-foreground">Calculated at checkout</dd>
                  </div>
                </dl>

                <Separator className="my-4" />

                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatMoney(subtotalCents, currency)}
                  </span>
                </div>

                <Button
                  type="submit"
                  className="mt-4 w-full"
                  size="lg"
                  disabled={!canSubmit || submitting}
                >
                  {submitting ? (
                    <>
                      <Spinner />
                      Redirecting to payment…
                    </>
                  ) : checking ? (
                    "Checking availability…"
                  ) : blocked.length > 0 ? (
                    "Edit your cart"
                  ) : (
                    "Pay now"
                  )}
                </Button>

                <p className="mt-3 text-xs text-muted-foreground">
                  You are taken to a secure payment page to pay. Prices and stock are confirmed
                  again when the order is created.
                </p>

                <Button variant="ghost" className="mt-2 w-full" asChild>
                  <Link href="/cart">Back to cart</Link>
                </Button>
              </CardContent>
            </Card>
          </aside>
        </form>
      </FormProvider>
    </Container>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner className="size-6" />
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}