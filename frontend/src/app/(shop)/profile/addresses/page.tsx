"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import type { SavedAddress } from "@/lib/addresses";
import { formatAddressLines } from "@/lib/addresses";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AccountShell from "@/components/layout/accountShell";
import { profileSection } from "@/components/layout/account-nav";

function AddressesPage() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<SavedAddress[]>("/addresses");
      setAddresses(res.data);
    } catch {
      // Empty book renders the same as a failed load; the form stays usable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function makeDefault(address: SavedAddress) {
    setBusyId(address.id);
    try {
      await api(`/addresses/${address.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDefault: true }),
      });
      toast.success(`${address.label || "Address"} is now your default.`);
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Could not change the default");
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
    <AccountShell section={profileSection()}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-base font-medium">Addresses</h2>
        <Button asChild>
          <Link href="/profile/addresses/new">Add Address</Link>
        </Button>
      </div>
      {addresses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">You don&apos;t have any addresses yet.</p>
            <Button asChild className="mt-4">
              <Link href="/profile/addresses/new">Add your first address</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {addresses.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>
                    {a.label || "Address"} — {a.recipientName}
                  </CardTitle>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatAddressLines(a).map((line, i) => (
                      <span key={i} className="block">
                        {line}
                      </span>
                    ))}
                    {a.phone && <span className="mt-1 block">Phone: {a.phone}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {a.isDefault && <Badge>Default</Badge>}
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/profile/addresses/${a.id}/edit`}>Edit</Link>
                </Button>
                {!a.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === a.id}
                    onClick={() => makeDefault(a)}
                  >
                    Make default
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AccountShell>
  );
}

export default function AddressesRoute() {
  return (
    <AuthGate>
      <AddressesPage />
    </AuthGate>
  );
}
