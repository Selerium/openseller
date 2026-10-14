"use client";

import { useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";
import { useTheme } from "next-themes";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "vanilla-calendar-pro";
import type { FormatDateString } from "vanilla-calendar-pro";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface DateFieldProps {
  name: string;
  label: string;
  maxDate?: string;
}

function localToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function DateField({ name, label, maxDate }: DateFieldProps) {
  const {
    setValue,
    watch,
    formState: { errors },
  } = useFormContext();

  // The calendar detects the theme from `html[data-theme]`, but next-themes is configured with
  // attribute="class", so that selector never matches and the library silently falls back to
  // `prefers-color-scheme`. With enableSystem={false} that meant an OS-dark visitor got a dark
  // popup inside a light form. Hand it the resolved theme instead of letting it guess.
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const calendarInstance = useRef<Calendar | null>(null);

  const value = (watch(name) as string) || "";
  const error = errors[name]?.message as string | undefined;
  const inputId = `${name}-input`;
  const max = (maxDate || localToday()) as FormatDateString;

  useEffect(() => {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) return;

    const calendar = new Calendar(input, {
      inputMode: true,
      positionToInput: "auto",
      selectedTheme: theme,
      selectedDates: value ? [value] : [],
      dateMax: max,
      onClickDate: (self) => {
        const next = self.context.selectedDates[0] || "";
        setValue(name, next, { shouldValidate: true });
      },
    });
    calendar.init();
    calendarInstance.current = calendar;

    return () => {
      calendar.destroy();
      calendarInstance.current = null;
    };
    // `theme` is in the deps so a theme switch rebuilds the popup with the right palette.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const calendar = calendarInstance.current;
    if (calendar) {
      calendar.set({ selectedDates: value ? [value] : [] }, { month: false, year: false });
    }
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (input) input.value = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Field data-invalid={Boolean(error)} className="w-full">
      <FieldLabel htmlFor={inputId} className="sr-only">
        {label}
      </FieldLabel>
      <div className="relative w-full">
        <Input
          id={inputId}
          readOnly
          placeholder={label}
          aria-invalid={Boolean(error)}
          className="cursor-pointer pr-10"
        />
        <CalendarIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}
