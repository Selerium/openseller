"use client";

import { useFormContext } from "react-hook-form";
import FormField from "@/components/form/formField";
import CountrySelector from "@/components/form/countrySelector";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

/**
 * Address form fields, expecting an enclosing FormProvider.
 *
 * Shared by /profile/addresses/new, /profile/addresses/[id]/edit and the
 * checkout page's inline "new address" section, so all three validate the same
 * shape (see lib/addresses.ts) and no copy drifts.
 */
export default function AddressFormFields({
  showLabel = true,
  showDefaultToggle = false,
}: {
  showLabel?: boolean;
  showDefaultToggle?: boolean;
}) {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext();

  const isDefault = watch("isDefault") === true;
  const defaultError = errors.isDefault?.message as string | undefined;

  return (
    <div className="flex flex-col gap-4">
      {showLabel && (
        <FormField
          name="label"
          label="Label"
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

      {showDefaultToggle && (
        <Field data-invalid={Boolean(defaultError)} orientation="horizontal">
          <Switch
            id="isDefault"
            checked={isDefault}
            onCheckedChange={(checked) =>
              setValue("isDefault", checked === true, {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
          />
          <FieldLabel htmlFor="isDefault">
            Make this my default address
          </FieldLabel>
          <input type="hidden" {...register("isDefault")} />
          <FieldError errors={defaultError ? [{ message: defaultError }] : undefined} />
        </Field>
      )}
    </div>
  );
}
