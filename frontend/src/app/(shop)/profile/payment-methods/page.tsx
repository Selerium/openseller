"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import AuthGate from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import AccountShell from "@/components/layout/accountShell";
import { profileSection } from "@/components/layout/account-nav";
import AddCardForm from "@/components/storefront/addCardForm";

interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/** Brands are lower-case from Stripe ("visa", "mastercard"); shown as words. */
function brandLabel(brand: string): string {
  if (!brand) return "Card";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function PaymentMethodsPage() {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Publishable key and Element provider.
  //
  // The key is fetched rather than compiled in: it is a deploy-time secret in the usual setup,
  // and baking it into the bundle would mean rebuilding the frontend to rotate it. `configured`
  // is checked separately so an unset key is reported as a server setup problem instead of
  // loadStripe("") failing somewhere inside Stripe's script.
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<SavedCard[]>("/account/payment-methods");
      setCards(res.data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load your cards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    api<{ publishableKey: string; configured: boolean }>(
      "/account/payment-methods/config"
    )
      .then((res) => {
        setStripeConfigured(res.data.configured);
        setPublishableKey(res.data.publishableKey || null);
      })
      .catch(() => setStripeConfigured(false));
  }, [load]);

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );

  async function makeDefault(card: SavedCard) {
    setBusyId(card.id);
    try {
      await api(`/account/payment-methods/${card.id}/default`, { method: "PATCH" });
      toast.success(`${brandLabel(card.brand)} ending ${card.last4} is now your default.`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to change the default card");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(card: SavedCard) {
    setBusyId(card.id);
    try {
      await api(`/account/payment-methods/${card.id}`, { method: "DELETE" });
      toast.success(`Removed ${brandLabel(card.brand)} ending ${card.last4}.`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove the card");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <AccountShell
      section={profileSection()}
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Payment Methods</CardTitle>
            <CardDescription>
              Cards you save here are offered to you at checkout. Stripe keeps the card details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved cards. You can still pay by card at checkout without saving one.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <CreditCard className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {brandLabel(card.brand)} ending {card.last4}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                      </p>
                    </div>

                    {card.isDefault ? (
                      <Badge>Default</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === card.id}
                        onClick={() => makeDefault(card)}
                      >
                        Make default
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${brandLabel(card.brand)} ending ${card.last4}`}
                      disabled={busyId === card.id}
                      onClick={() => remove(card)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {stripeConfigured === false ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Card saving is not available on this server. Payments have not been configured.
              </p>
            </CardContent>
          </Card>
        ) : stripePromise ? (
          // The provider is mounted only once the key has arrived, so <Elements> is never
          // created against a null Stripe object — which it treats as a permanent error.
          <Elements stripe={stripePromise}>
            <AddCardForm onAdded={load} />
          </Elements>
        ) : (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        )}
      </div>
    </AccountShell>
  );
}

export default function PaymentMethodsRoute() {
  return (
    <AuthGate>
      <PaymentMethodsPage />
    </AuthGate>
  );
}
