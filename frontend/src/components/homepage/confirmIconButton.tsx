"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * An icon button that asks twice.
 *
 * Destructive edits here have no undo — autosave has already PUT the change by the time the
 * admin would think better of it — so the click that removes something must not be the click
 * that was meant to move it. A modal for a two-word confirmation is more ceremony than it is
 * worth, and this repo has no alert-dialog, so: first press arms, the button visibly reddens
 * for three seconds, second press goes through.
 *
 * Re-arming restarts the window, and the timer is cleared on unmount so a component that
 * disappears mid-window cannot warn its parent later.
 */
export default function ConfirmIconButton({
  label,
  confirmLabel,
  icon: Icon,
  onConfirm,
  disabled,
  className,
}: {
  label: string;
  /** Shown in the tooltip while armed. Defaults to "Confirm <label>". */
  confirmLabel?: string;
  icon: LucideIcon;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const description = armed
    ? (confirmLabel ?? `Confirm: ${label.toLowerCase()}`)
    : label;

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      disabled={disabled}
      title={armed ? description : `${label} (press twice to confirm)`}
      aria-label={description}
      aria-pressed={armed}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
      }}
      className={cn(
        armed &&
          "bg-destructive/15 text-destructive ring-1 ring-destructive/60 hover:bg-destructive/20 hover:text-destructive",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}
