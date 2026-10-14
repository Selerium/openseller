"use client";

import { cn } from "@/lib/utils";
import { ELEMENTS } from "./registry";
import type { ElementKind } from "./types";

/**
 * The element palette.
 *
 * Insertion is two clicks by design: pick an element here, then pick a column on the canvas.
 * The alternative — dragging — needs a dependency and is worse on a touch device, and this
 * interaction is only ever one of two steps anyway.
 *
 * The sidebar never decides *where* anything goes, so it holds no tree state at all: it
 * reports which kind is armed and the editor does the rest. `aria-pressed` on each entry is
 * what makes the armed state legible to a screen reader, which would otherwise have no way to
 * know that clicking a column next is the point.
 */
export default function ElementSidebar({
  armed,
  onToggle,
}: {
  armed: ElementKind | null;
  onToggle: (kind: ElementKind) => void;
}) {
  return (
    <aside className="flex flex-col gap-3 border-b border-border bg-card/60 p-4 lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div>
        <h2 className="text-sm font-semibold">Elements</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick an element, then click the column you want it in.
        </p>
      </div>

      <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1.5">
        {ELEMENTS.map((def) => {
          const Icon = def.icon;
          const active = armed === def.kind;

          return (
            <li key={def.kind} className="min-w-0 lg:w-full">
              <button
                type="button"
                data-arming="true"
                aria-pressed={active}
                onClick={() => onToggle(def.kind)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-transparent hover:bg-muted",
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{def.label}</span>
                  <span className="hidden text-xs text-muted-foreground lg:block">{def.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        {armed
          ? "Now click a column to place it. Press Esc to cancel."
          : "Nothing selected yet. The column you pick lights up once you choose an element."}
      </p>
    </aside>
  );
}
