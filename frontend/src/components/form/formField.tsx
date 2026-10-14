"use client";

import { useState, type ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

interface FormFieldProps {
  name: string;
  label: string;
  type?: "email" | "password" | string;
  placeholder?: string;
  minLength?: number;
  step?: string | number;
  autoComplete?: string;
  icon?: ReactNode;
}

export default function FormField({
  name,
  label,
  type = "text",
  placeholder,
  minLength,
  step,
  autoComplete,
  icon,
}: FormFieldProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext();

  const [visible, setVisible] = useState(false);
  const error = errors[name]?.message as string | undefined;

  const isEmail = type === "email";
  const isPassword = type === "password";
  const effectiveType = isPassword ? (visible ? "text" : "password") : type;
  const effectivePlaceholder =
    placeholder || (isEmail ? "Email" : isPassword ? "Password" : "Enter text");

  const leadingIcon = icon ?? (isEmail ? <Mail /> : isPassword ? <Lock /> : null);

  return (
    <Field data-invalid={Boolean(error)} className="w-full">
      <FieldLabel htmlFor={name} className="sr-only">
        {label}
      </FieldLabel>
      <InputGroup>
        {leadingIcon && <InputGroupAddon>{leadingIcon}</InputGroupAddon>}
        <InputGroupInput
          id={name}
          type={effectiveType}
          placeholder={effectivePlaceholder}
          minLength={minLength}
          step={step}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          {...register(name)}
        />
        {isPassword && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              tabIndex={-1}
              aria-label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}
