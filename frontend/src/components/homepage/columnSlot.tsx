"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ElementCard from "./elementCard";
import { labelFor } from "./registry";
import type { EditorActions, HomeColumn } from "./types";

/**
 * One column of a section.
 *
 * The whole column is the target while an element is armed in the sidebar: an overlay
 * button covers it, so wherever the admin clicks inside it the element lands there. Overlay
 * rather than an onClick on the container because the column holds real buttons — element
 * edit and reorder controls — and those must not also fire the insert while a click passes
 * through them.
 *
 * Columns are equal width and always present, even empty: this is the same "one cell per
 * column" rule the storefront renderer follows, so an empty column still holds its share of
 * the row instead of letting the others reflow wider.
 *
 * An empty column also carries the only remove control in the tree — a trash button in its
 * corner, revealed on hover and focus like every other canvas control. A column *with* elements gets
 * no button at all: dropping it would take the elements with it, and emptying it first is
 * one click per element away. A section's last column gets a button that refuses to work,
 * since a columnless section is what the backend validator fails. Both rules are re-checked
 * by removeColumn itself (editor.tsx), so the UI here is a disclosure, not the guard.
 */
export default function ColumnSlot({
  column,
  armed,
  onInsert,
  actions,
  canRemove,
}: {
  column: HomeColumn;
  /** The kind the sidebar has armed, or null when nothing is being inserted. */
  armed: string | null;
  onInsert: () => void;
  actions: EditorActions;
  /** False while this is the section's only column — see the doc comment above. */
  canRemove: boolean;
}) {
  const empty = column.elements.length === 0;

  return (
    <div
      className={cn(
        "group relative min-w-0 rounded-lg border p-2",
        armed ? "border-dashed border-primary/60" : "border-border/70",
        empty && "bg-muted/20",
      )}
    >
      {armed && (
        <button
          type="button"
          data-insert-target="true"
          onClick={(event) => {
            event.stopPropagation();
            onInsert();
          }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary bg-primary/10 px-2 text-center text-sm font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <Plus className="size-5" />
          Add {labelFor(armed).toLowerCase()} here
        </button>
      )}

      {!armed && empty && (
        <>
          {/* Empty means empty and nothing is being inserted, so this deletes instantly —
              no confirmation for a cell with nothing in it, and one "Add column" click puts
              it back. Keyboard users reach it by tabbing: focus-within reveals it the same
              way hover does. */}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={!canRemove}
            title={
              canRemove
                ? "Delete this empty column"
                : "A section needs at least one column — delete the section instead"
            }
            aria-label="Delete this empty column"
            onClick={() => actions.removeColumn(column.id)}
            className={cn(
              "absolute right-1 top-1 z-20 opacity-0 transition-opacity",
              "group-hover:opacity-100 group-focus-within:opacity-100",
              "text-destructive hover:text-destructive",
            )}
          >
            <Trash2 className="size-3.5" />
          </Button>

          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Empty column — pick an element on the left to add it here.
          </p>
        </>
      )}

      <div className={cn("space-y-2", armed && "pointer-events-none select-none opacity-40")}>
        {column.elements.map((element, index) => (
          <ElementCard
            key={element.id}
            element={element}
            index={index}
            count={column.elements.length}
            actions={actions}
          />
        ))}
      </div>
    </div>
  );
}
