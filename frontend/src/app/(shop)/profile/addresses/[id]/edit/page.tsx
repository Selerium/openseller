"use client";

import AuthGate from "@/components/auth-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Container from "@/components/layout/container";

function EditAddressPage() {
  return (
    <Container className="max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Edit Address</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Address editing UI - coming soon</p>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function EditAddressRoute() {
  return (
    <AuthGate>
      <EditAddressPage />
    </AuthGate>
  );
}
