"use client";

import AuthGate from "@/components/auth-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Container from "@/components/layout/container";

function NewAddressPage() {
  return (
    <Container className="max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Add New Address</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Address creation UI - coming soon</p>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function NewAddressRoute() {
  return (
    <AuthGate>
      <NewAddressPage />
    </AuthGate>
  );
}
