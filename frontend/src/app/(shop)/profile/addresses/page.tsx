"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthGate from "@/components/auth-gate";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AccountShell from "@/components/layout/accountShell";
import { profileSection } from "@/components/layout/account-nav";

interface Address {
  id: string;
  firstName: string;
  lastName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api<Address[]>("/addresses");
        setAddresses(res.data);
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

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
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle>
                    {a.firstName} {a.lastName}
                  </CardTitle>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {a.line1}
                    {a.line2 && <span>, {a.line2}</span>}
                    <br />
                    {a.city}, {a.region ?? ""} {a.postalCode}
                    <br />
                    {a.country}
                    {a.phone && <span className="block mt-1">Phone: {a.phone}</span>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.isDefaultShipping && <Badge>Default shipping</Badge>}
                  {a.isDefaultBilling && <Badge variant="outline">Default billing</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/profile/addresses/${a.id}/edit`}>Edit</Link>
                </Button>
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
