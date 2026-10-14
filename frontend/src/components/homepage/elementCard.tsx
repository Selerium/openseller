"use client";

import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmIconButton from "./confirmIconButton";
import { iconFor, labelFor } from "./registry";
import type { EditorActions, HomeElement } from "./types";

/**
 * One element as the editor sees it: a labelled card with its controls in the top-right.
 *
 * The edit icon is always visible — it is the control the admin is meant to reach for, and
 * hiding it behind a hover would make an element look inert. The rest (reorder, delete) only
 * appear on hover or keyboard focus, because four permanently visible icons on every element
 * of every column is a lot of chrome around content that is meant to be read.
 *
 * Opacity rather than `hidden`, so the controls stay in the tab order while invisible:
 * `focus-within` brings them back up the moment they are focused.
 */
export default function ElementCard({
  element,
  index,
  count,
  actions,
}: {
  element: HomeElement;
  index: number;
  count: number;
  actions: EditorActions;
}) {
  const Icon = iconFor(element.kind);
  const label = labelFor(element.kind);

  return (
    <div className="group relative rounded-lg border bg-card p-3 shadow-xs">
      {/* Right padding keeps the title clear of the control cluster, which is always wider
          than it looks: four 28px buttons plus gaps. */}
      <div className="flex items-center gap-2 pr-24">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>

      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={`Edit ${label.toLowerCase()}`}
          aria-label={`Edit ${label.toLowerCase()}`}
          onClick={() => actions.editElement(element.id)}
        >
          <Pencil className="size-3.5" />
        </Button>

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={index === 0}
            title="Move element up"
            aria-label="Move element up"
            onClick={() => actions.moveElement(element.id, -1)}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={index === count - 1}
            title="Move element down"
            aria-label="Move element down"
            onClick={() => actions.moveElement(element.id, 1)}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <ConfirmIconButton
            label="Delete element"
            icon={Trash2}
            onConfirm={() => actions.removeElement(element.id)}
            className="text-destructive hover:text-destructive"
          />
        </div>
      </div>
    </div>
  );
}
