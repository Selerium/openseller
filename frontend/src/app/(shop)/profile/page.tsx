"use client";

import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { useEffect, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import FormField from "@/components/form/formField";
import CountrySelector from "@/components/form/countrySelector";
import AuthGate from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import AccountShell from "@/components/layout/accountShell";
import { profileSection } from "@/components/layout/account-nav";

interface Profile {
  createdAt: string;
  user: { name: string; email: string };
  role: string;
  firstTime: boolean;
  gender: string | null;
  dob: string | null;
  nationality: string | null;
  phone: string | null;
}

const profileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  nationality: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

/**
 * Split from the exported wrapper below so the gate sits above the component, not above its
 * JSX. Wrapping the returned markup instead would leave this component's own `loading` branch
 * rendering first, and its /profile fetch would fire on mount for anyone the gate is about to
 * hide. Mounted inside the gate, it does not run at all until there is a session to run it with.
 */
function ProfilePage() {
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: "", phone: "", nationality: "" },
  });

  useEffect(() => {
    api<Profile>("/profile")
      .then((res) => {
        setProfile(res.data);
        methods.reset({
          name: res.data.user.name,
          phone: res.data.phone || "",
          nationality: res.data.nationality || "",
        });
      })
      .catch((err: any) => toast.error(err.message || "Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(data: ProfileFormData) {
    setSaving(true);

    try {
      const res = await idem.run((idempotencyKey) =>
        api<Profile>("/profile", {
          method: "PUT",
          body: JSON.stringify(data),
          idempotencyKey,
        })
      );
      setProfile(res.data);
      await refreshUser();
      toast.success("Profile updated successfully.");
    } catch (err: any) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <AccountShell
      section={profileSection()}
    >
      <FormProvider {...methods}>
        <Card>
          <CardHeader>
            <CardTitle>Personal Info</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={methods.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField name="name" label="Name" />

              <FormField name="phone" label="Phone" type="tel" />

              <CountrySelector name="nationality" />

              <div className="text-sm text-muted-foreground">
                <p>Email: {profile?.user.email}</p>
                <p>Role: {profile?.role}</p>
              </div>

              <Button type="submit" className="self-start" disabled={saving}>
                {saving ? <Spinner /> : "Save Changes"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </FormProvider>
    </AccountShell>
  );
}

export default function ProfileRoute() {
  return (
    <AuthGate>
      <ProfilePage />
    </AuthGate>
  );
}
