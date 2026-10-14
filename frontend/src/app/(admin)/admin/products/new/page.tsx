"use client";

import AuthGate from "@/components/auth-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Container from "@/components/layout/container";

function NewProductPage() {
  return (
    <Container className="max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Product</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Product creation UI - coming soon</p>
        </CardContent>
      </Card>
    </Container>
  );
}

export default function NewProductRoute() {
  return (
    <AuthGate>
      <NewProductPage />
    </AuthGate>
  );
}
