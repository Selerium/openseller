"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuantityStepperProps {
  value: number;
  /** Hard ceiling. The increment control disables here rather than clamping silently. */
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Quantity stepper.
 *
 * Shared by the product page and the cart so the clamping rule lives in one place. It never
 * reports a quantity above `max`: stock can move between render and click, and a stepper showing
 * 5 against a stock of 2 is an order that cannot be placed.
 *
 * `max` is floored at 1 rather than allowed to reach 0. A zero ceiling means the variant is
 * unbuyable, and callers are expected to say so themselves ("Out of stock") instead of rendering
 * a control pinned at its minimum.
 */
export default function QuantityStepper({
  value,
  max,
  onChange,
  disabled = false,
  className,
}: QuantityStepperProps) {
  const ceiling = Math.max(max, 1);
  const shown = Math.min(Math.max(value, 1), ceiling);

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-border",
        disabled && "opacity-50",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-r-none"
        disabled={disabled || shown <= 1}
        onClick={() => onChange(shown - 1)}
        aria-label="Decrease quantity"
      >
        <Minus className="size-3.5" />
      </Button>

      <span
        className="w-10 text-center text-sm tabular-nums"
        aria-live="polite"
        aria-label="Quantity"
      >
        {shown}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-l-none"
        disabled={disabled || shown >= ceiling}
        onClick={() => onChange(shown + 1)}
        aria-label="Increase quantity"
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}