"use client";

import { useState } from "react";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeCardElementChangeEvent } from "@stripe/stripe-js";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Add a card.
 *
 * Three calls, in this order, and the order is the whole design:
 *
 *   1. POST /account/payment-methods/setup-intent  — ask our API for a SetupIntent
 *   2. stripe.confirmSetup(...)                    — hand the card to Stripe
 *   3. POST /account/payment-methods/attach        — tell our API the card is now real
 *
 * The card number is only ever in step 2, inside Stripe's own iframe. It is never in a request
 * to our API, which is what keeps this page out of PCI scope: we handle a SetupIntent id and a
 * Stripe payment-method id, never a PAN.
 *
 * Step 3 is not optional bookkeeping. Our API cannot see that step 2 succeeded, so until the
 * browser reports back there is no card on file — and the browser is the only party that can
 * vouch for it. The server verifies the SetupIntent really belongs to this shopper's customer
 * before writing the row.
 *
 * Must be rendered inside <Elements>. See the payment-methods page, which owns the publishable
 * key and therefore the provider.
 */
export default function AddCardForm({ onAdded }: { onAdded: () => void }) {
  const stripe = useStripe();
  const elements = useElements();

  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  // Two keys, two intents: the setup-intent call and the attach call are different requests, and
  // sharing one key between them would make the second replay as the first.
  const setupIdem = useIdempotency();
  const attachIdem = useIdempotency();

  const ready = Boolean(stripe && elements);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || saving) return;

    setSaving(true);
    setCardError(null);

    try {
      // 1. A SetupIntent, scoped to this shopper's Stripe customer.
      const intent = await setupIdem.run((idempotencyKey) =>
        api<{ setupIntentId: string; clientSecret: string }>(
          "/account/payment-methods/setup-intent",
          { method: "POST", idempotencyKey }
        )
      );

      // 2. The card goes to Stripe, from the browser, and only to Stripe.
      //
      // redirect: "if_required" because a card never redirects. Left at its default ("always"),
      // Stripe would treat the successful save as a navigation and unmount this page mid-flow.
      const { error } = await stripe.confirmSetup({
        elements,
        clientSecret: intent.data.clientSecret,
        redirect: "if_required",
      });

      if (error) {
        // Stripe's message is written for a shopper ("Your card number is incomplete"), so it is
        // shown as-is rather than replaced with something vaguer.
        setCardError(error.message || "Your card could not be saved.");
        return;
      }

      // 3. Record it. A failure here leaves a card on Stripe that is not in our book, which the
      // shopper can fix by saving it again — the attach is idempotent on the payment-method id.
      await attachIdem.run((idempotencyKey) =>
        api("/account/payment-methods/attach", {
          method: "POST",
          body: JSON.stringify({ setupIntentId: intent.data.setupIntentId }),
          idempotencyKey,
        })
      );

      setComplete(true);
      onAdded();
    } catch (err: any) {
      setCardError(err.message || "Your card could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function handleChange(event: StripeCardElementChangeEvent) {
    setCardError(null);
    setComplete(event.complete);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a card</CardTitle>
        <CardDescription>
          Stripe checks the card and stores it. Card details never touch our servers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div
            className="rounded-lg border border-border px-3 py-2.5"
            // Stripe renders the input inside its own iframe, so there is no element here to
            // label or to hang an id on. The wrapper takes the label instead, and the visible
            // text stands in for a hidden <label> that cannot exist across the iframe boundary.
            role="group"
            aria-label="Card details"
          >
            <CardElement
              onChange={handleChange}
              options={{
                style: {
                  base: {
                    fontSize: "14px",
                    color: "#171717",
                    fontFamily: "inherit",
                    "::placeholder": { color: "#a3a3a3" },
                  },
                  invalid: { color: "#dc2626" },
                },
              }}
            />
          </div>

          {cardError && (
            <p role="alert" className="text-sm text-destructive">
              {cardError}
            </p>
          )}

          <Button type="submit" className="self-start" disabled={!ready || saving || !complete}>
            {saving ? <Spinner /> : "Save card"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
