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
 *
 * Signed-in shoppers get their address book here: a dropdown of saved addresses (each option
 * carries label, name, street, city, country and phone, so three "Home" rows are still telling
 * apart) plus an "add a new address" choice that can also save the new row to the book. Guests
 * type everything by hand; when a guest email already has an account they are asked to log in
 * instead, with the cart kept in localStorage so it survives the trip to /login and back.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { LogIn, PackageOpen, TriangleAlert } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { formatMoney } from "@/lib/money";
import {
  formatAddressOption,
  type SavedAddress,
} from "@/lib/addresses";

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
import { Switch } from "@/components/ui/switch";
import Container from "@/components/layout/container";

/**
 * Mirrors the limits in backend/src/lib/address.ts.
 *
 * Duplicated rather than imported because those are two separate deployables with no shared
 * package. Matching them here means an over-long value is refused in the form instead of costing a
 * round trip to be refused with the same message.
 *
 * `label` is only sent when a signed-in shopper saves the new address to their book; the
 * checkout session itself carries no label.
 */
const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  label: z.string().max(40).optional().default(""),
  discountCode: z.string().max(32).optional().default(""),
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

type CheckoutFormData = z.input<typeof schema>;

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

const NEW_ADDRESS = "__new__";

function addressToForm(address: SavedAddress): Omit<CheckoutFormData, "email" | "label"> {
  return {
    recipientName: address.recipientName ?? "",
    line1: address.line1 ?? "",
    line2: address.line2 ?? "",
    city: address.city ?? "",
    region: address.region ?? "",
    postalCode: address.postalCode ?? "",
    countryCode: address.countryCode ?? "",
    phone: address.phone ?? "",
  };
}

function CheckoutContent() {
  const { user, loading: authLoading } = useAuth();
  const { lines, issues, hydrated, reconcile } = useCart();
  const idem = useIdempotency();

  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // --- address book (signed-in shoppers only) ---
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [saveNewAddress, setSaveNewAddress] = useState(true);
  const addressInitialised = useRef(false);

  // --- guest email -> existing account check ---
  const [emailExists, setEmailExists] = useState(false);
  const [emailChecking, setEmailChecking] = useState(false);

  // --- discount code ---
  const [discountInput, setDiscountInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    percentOff: number;
  } | null>(null);
  const [discountBusy, setDiscountBusy] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  const methods = useForm<CheckoutFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      label: "",
      discountCode: "",
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
  const { reset, getValues, setValue, watch } = methods;
  const watchedEmail = watch("email");

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

  // Load the address book for signed-in shoppers, once per session.
  useEffect(() => {
    if (!user) {
      setAddresses([]);
      setAddressesLoading(false);
      return;
    }
    let cancelled = false;
    setAddressesLoading(true);
    api<SavedAddress[]>("/addresses")
      .then((res) => {
        if (!cancelled) setAddresses(res.data);
      })
      .catch(() => {
        // A failure here is not an error: the form is empty and perfectly usable.
      })
      .finally(() => {
        if (!cancelled) setAddressesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Prefill email from the session, once. Guarded by a ref because it is a one-shot: a later
  // `lines` change, or any render producing a fresh `user` object, must not stomp a half-typed
  // address.
  const emailPrefilled = useRef(false);
  useEffect(() => {
    if (!user || emailPrefilled.current) return;
    emailPrefilled.current = true;
    reset({ ...getValues(), email: user.email ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Pick the initial address choice once the book has loaded: the default (or first) saved
  // address, otherwise a blank new-address form.
  useEffect(() => {
    if (!user || addressesLoading || addressInitialised.current) return;
    addressInitialised.current = true;
    const preferred =
      addresses.find((address) => address.isDefault) ?? addresses[0];
    if (preferred) {
      setSelectedAddressId(preferred.id);
      reset({ ...getValues(), email: user.email ?? "", ...addressToForm(preferred) });
    } else {
      setSelectedAddressId(NEW_ADDRESS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, addressesLoading, addresses]);

  // Reset the flag when the session changes, so signing in as someone else re-runs the
  // one-shot prefills above instead of keeping the previous shopper's address.
  useEffect(() => {
    if (!user) {
      emailPrefilled.current = false;
      addressInitialised.current = false;
      setSelectedAddressId(null);
    }
  }, [user]);

  function handleAddressSelect(value: string) {
    setSelectedAddressId(value);
    if (value === NEW_ADDRESS) {
      const current = getValues();
      reset({
        email: current.email,
        label: "",
        recipientName: "",
        line1: "",
        line2: "",
        city: "",
        region: "",
        postalCode: "",
        countryCode: "",
        phone: "",
      });
      setSaveNewAddress(true);
      return;
    }
    const chosen = addresses.find((address) => address.id === value);
    if (!chosen) return;
    const current = getValues();
    reset({ ...current, ...addressToForm(chosen) });
  }

  // Guest email check: when a signed-out shopper types an address that already has an account,
  // they are asked to log in rather than checking out as a guest. Debounced so it fires once
  // the typing pauses, and skipped for signed-in shoppers (the session already tells us who
  // they are) and for values that are not even an email shape.
  useEffect(() => {
    if (user) {
      setEmailExists(false);
      return;
    }
    const email = (watchedEmail ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailExists(false);
      return;
    }
    let cancelled = false;
    setEmailChecking(true);
    const timer = setTimeout(() => {
      api<{ exists: boolean }>("/check-email", {
        method: "POST",
        body: JSON.stringify({ email }),
      })
        .then((res) => {
          if (!cancelled) setEmailExists(res.data.exists === true);
        })
        .catch(() => {
          // A failed check must not block checkout; the guest simply continues as a guest.
          if (!cancelled) setEmailExists(false);
        })
        .finally(() => {
          if (!cancelled) setEmailChecking(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [watchedEmail, user]);

  const blocked = lines.filter((line) => line.variantId in issues);
  const payable = lines.filter((line) => !(line.variantId in issues));

  const currency = payable[0]?.currency ?? lines[0]?.currency ?? "usd";
  const subtotalCents = payable.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0
  );

  // The preview math mirrors the session's: whole minor units, rounded half-up, never more
  // than the subtotal. The server re-derives it regardless, so this is display only.
  const discountCents = appliedDiscount
    ? Math.min(subtotalCents, Math.round((subtotalCents * appliedDiscount.percentOff) / 100))
    : 0;
  const totalCents = subtotalCents - discountCents;

  // A guest whose email already has an account is held at the gate: submitting as a guest
  // would write a guest order under an address the shop already knows, leaving the shopper
  // with two identities. They log in (the cart lives in localStorage, so it survives the
  // trip) and finish as themselves.
  const heldForLogin = !user && emailExists;

  // Blocking on `blocked` rather than clearing those issues, which is what the old stub did:
  // clearing them here would let the shopper pay for a line that is no longer buyable, and the
  // endpoint would answer 409 anyway.
  const canSubmit =
    payable.length > 0 && blocked.length === 0 && !checking && !heldForLogin;

  const usingSavedAddress =
    !!user && selectedAddressId !== null && selectedAddressId !== NEW_ADDRESS;
  const showNewAddressForm = !user || selectedAddressId === NEW_ADDRESS;

  /**
   * Check a code against the server and, when it holds, pin it to this checkout.
   *
   * Advisory only: the session re-validates at purchase time, so a code switched off in
   * between is refused there. A failed check clears nothing the shopper already had — an
   * unrelated network blip must not eat a good code.
   */
  async function applyDiscountCode() {
    const raw = discountInput.trim();
    if (!raw || discountBusy) return;
    setDiscountBusy(true);
    setDiscountError(null);
    try {
      const res = await api<{ code: string; percentOff: number }>(
        `/checkout/discount/validate?code=${encodeURIComponent(raw)}`
      );
      setAppliedDiscount({ code: res.data.code, percentOff: res.data.percentOff });
      setValue("discountCode", res.data.code);
      setDiscountInput("");
      toast.success(`${res.data.percentOff}% off applied`);
    } catch (err: unknown) {
      setDiscountError((err as { message?: string })?.message || "That code did not work");
    } finally {
      setDiscountBusy(false);
    }
  }

  function removeDiscount() {
    setAppliedDiscount(null);
    setDiscountError(null);
    setValue("discountCode", "");
  }

  async function onSubmit(data: CheckoutFormData) {
    if (heldForLogin) {
      toast.error("Please log in first", {
        description: "An account already exists for this email address.",
      });
      return;
    }

    setSubmitting(true);

    // Optional fields are sent as null rather than "": the backend's `optionalString` treats both
    // as absent, but null is what it stores, so an empty string would round-trip into the order
    // snapshot as a blank line instead of nothing.
    const emptyToNull = (value: string) => value.trim() || null;

    try {
      // A signed-in shopper adding a new address can keep it: it is saved to the book first,
      // so the order and the book hold the same snapshot, and the new row immediately joins
      // the dropdown for next time.
      if (user && selectedAddressId === NEW_ADDRESS && saveNewAddress) {
        try {
          const saved = await api<SavedAddress>("/addresses", {
            method: "POST",
            body: JSON.stringify({
              label: (data.label ?? "").trim() || "Home",
              recipientName: data.recipientName.trim(),
              line1: data.line1.trim(),
              line2: emptyToNull(data.line2),
              city: data.city.trim(),
              region: emptyToNull(data.region),
              postalCode: emptyToNull(data.postalCode),
              countryCode: data.countryCode.trim().toUpperCase(),
              phone: emptyToNull(data.phone),
            }),
          });
          setAddresses((prev) =>
            prev.some((a) => a.id === saved.data.id) ? prev : [...prev, saved.data]
          );
          setSelectedAddressId(saved.data.id);
        } catch (saveError: unknown) {
          // Saving is a convenience, not the purchase: a book failure must not lose the
          // checkout itself, so the order still goes through with the typed address.
          toast.error("Address was not saved", {
            description:
              (saveError as { message?: string })?.message ||
              "Continuing with this order only.",
          });
        }
      }

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
            // The code string only; the session looks up the percent itself, so a preview
            // from before the code was switched off cannot buy a discount that no longer
            // exists. Absent entirely when no code is applied, not an empty string.
            ...(appliedDiscount ? { discountCode: appliedDiscount.code } : {}),
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
                {emailChecking && (
                  <p className="mt-2 text-xs text-muted-foreground">Checking email…</p>
                )}
                {heldForLogin && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <LogIn className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div className="flex flex-col gap-2">
                      <p>
                        An account already exists for{" "}
                        <span className="font-medium">{watchedEmail.trim()}</span>. Please log
                        in to continue checking out as yourself.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Your cart is kept in this browser&apos;s local storage, so it will
                        still be here after you sign in — you will come back to the cart
                        and continue to checkout from there.
                      </p>
                      <Button size="sm" className="w-fit" asChild>
                        <Link
                          href={`/login?redirect=${encodeURIComponent("/cart")}`}
                        >
                          <LogIn className="size-3.5" />
                          Log in to continue
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Delivery address</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {user && (
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="saved-address"
                      className="text-sm font-medium"
                    >
                      Use a saved address
                    </label>
                    <select
                      id="saved-address"
                      className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                      value={selectedAddressId ?? NEW_ADDRESS}
                      onChange={(e) => handleAddressSelect(e.target.value)}
                      disabled={addressesLoading}
                    >
                      {addresses.map((address) => (
                        <option key={address.id} value={address.id}>
                          {formatAddressOption(address)}
                        </option>
                      ))}
                      <option value={NEW_ADDRESS}>＋ Add a new address…</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {addressesLoading
                        ? "Loading your saved addresses…"
                        : addresses.length > 0
                          ? "Each option shows label, name, street, city, country and phone so you can tell them apart."
                          : "You have no saved addresses yet — fill in the form below."}
                    </p>
                  </div>
                )}

                {showNewAddressForm && (
                  <>
                    {user && (
                      <p className="text-sm text-muted-foreground">
                        {usingSavedAddress
                          ? ""
                          : "Add a new address. It will be used for this order."}
                      </p>
                    )}
                    <FieldSet>
                      <FieldLegend variant="label" className="sr-only">
                        Delivery address
                      </FieldLegend>
                      {user && selectedAddressId === NEW_ADDRESS && (
                        <FormField
                          name="label"
                          label="Address label (optional)"
                          placeholder="Home, Work, …"
                          autoComplete="off"
                        />
                      )}
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

                    {user && selectedAddressId === NEW_ADDRESS && (
                      <label
                        htmlFor="save-address"
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Switch
                          id="save-address"
                          checked={saveNewAddress}
                          onCheckedChange={(checked) =>
                            setSaveNewAddress(checked === true)
                          }
                        />
                        <span>Save this address to my address book</span>
                      </label>
                    )}
                  </>
                )}

                {usingSavedAddress && (
                  <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                    Using your saved address. Choose “Add a new address…” above to enter a
                    different one — you can save it to your book as well.{" "}
                    <Link
                      href="/profile/addresses"
                      className="underline underline-offset-2"
                    >
                      Manage addresses
                    </Link>
                  </p>
                )}
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
                  {appliedDiscount ? (
                    <div className="flex items-center justify-between gap-2 text-green-700 dark:text-green-400">
                      <dt>
                        Discount ({appliedDiscount.code} • {appliedDiscount.percentOff}% off)
                      </dt>
                      <dd className="flex items-center gap-2 tabular-nums">
                        −{formatMoney(discountCents, currency)}
                        <button
                          type="button"
                          onClick={removeDiscount}
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          Remove
                        </button>
                      </dd>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={discountInput}
                          onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
                          placeholder="Discount code"
                          autoComplete="off"
                          maxLength={32}
                          disabled={discountBusy}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void applyDiscountCode();
                            }
                          }}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0"
                          disabled={!discountInput.trim() || discountBusy}
                          onClick={() => void applyDiscountCode()}
                        >
                          {discountBusy ? "Checking…" : "Apply"}
                        </Button>
                      </div>
                      {discountError && (
                        <p className="text-xs text-destructive">{discountError}</p>
                      )}
                    </div>
                  )}
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
                    {formatMoney(totalCents, currency)}
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
                  ) : heldForLogin ? (
                    "Log in to continue"
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
