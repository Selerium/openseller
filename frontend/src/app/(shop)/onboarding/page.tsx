"use client";

import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useIdempotency } from "@/lib/idempotency";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import FormField from "@/components/form/formField";
import DateField from "@/components/form/dateField";
import CountrySelector from "@/components/form/countrySelector";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";

const onboardingSchema = z.object({
  gender: z.enum(["MALE", "FEMALE"]),
  dob: z.string().min(1, "Date of birth is required"),
  nationality: z.string().min(1, "Nationality is required"),
  phone: z.string().min(1, "Phone is required"),
});

type OnboardingFormData = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const idem = useIdempotency();

  const methods = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      gender: "MALE",
      dob: "",
      nationality: "",
      phone: "",
    },
  });

  useEffect(() => {
    if (user && !user.firstTime) {
      router.replace("/profile");
    }
  }, [user, router]);

  async function onSubmit(data: OnboardingFormData) {
    setLoading(true);

    try {
      await idem.run((idempotencyKey) =>
        api("/profile/first-time", {
          method: "POST",
          body: JSON.stringify(data),
          idempotencyKey,
        })
      );
      await refreshUser();
      router.replace("/profile");
    } catch (err: any) {
      toast.error(err.message || "Failed to complete onboarding");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      <FormProvider {...methods}>
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Complete Your Profile</CardTitle>
            <p className="text-center text-muted-foreground">
              Tell us a bit about yourself to get started.
            </p>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <form
              onSubmit={methods.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FieldSet>
                <FieldLegend variant="label">Gender</FieldLegend>
                <Controller
                  control={methods.control}
                  name="gender"
                  render={({ field }) => (
                    <Field
                      orientation="horizontal"
                      className="flex-row items-center gap-6"
                    >
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="contents"
                      >
                        <FieldLabel htmlFor="gender-male">
                          <RadioGroupItem id="gender-male" value="MALE" />
                          Male
                        </FieldLabel>
                        <FieldLabel htmlFor="gender-female">
                          <RadioGroupItem id="gender-female" value="FEMALE" />
                          Female
                        </FieldLabel>
                      </RadioGroup>
                    </Field>
                  )}
                />
              </FieldSet>

              <DateField name="dob" label="Date of Birth" />

              <CountrySelector name="nationality" />

              <FormField
                name="phone"
                label="Phone"
                type="tel"
                placeholder="Phone Number"
              />

              <Button type="submit" className="mt-2 w-full" disabled={loading}>
                {loading ? <Spinner /> : "Get Started"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </FormProvider>
    </div>
  );
}
