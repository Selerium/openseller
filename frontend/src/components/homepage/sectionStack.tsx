"use client";

import type { CSSProperties } from "react";
import { ChevronDown, ChevronUp, Columns3, Palette, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ColumnSlot from "./columnSlot";
import ConfirmIconButton from "./confirmIconButton";
import type { EditorActions, HomeBackground, HomeLayout, HomePadding, HomeSection } from "./types";
import { MAX_COLUMNS, MAX_SECTIONS } from "./types";

/**
 * The canvas: every section, stacked, with an "Add section" button underneath.
 *
 * Each section carries its controls in a strip down its left side rather than in a toolbar
 * above it — delete, add column, reorder and settings all belong to *that* section, and a
 * shared toolbar would need a selection state to say which one it was talking about. The
 * strip is the selection.
 *
 * The strip is visible on hover like the element controls, with one difference: it is also
 * revealed by focus-within, so the buttons are reachable by keyboard without hunting.
 */
export default function SectionStack({
  sections,
  armed,
  actions,
  onAddSection,
}: {
  sections: HomeLayout["sections"];
  armed: string | null;
  actions: EditorActions;
  onAddSection: () => void;
}) {
  return (
    <div className="space-y-4">
      {sections.map((section, index) => (
        <SectionRow
          key={section.id}
          section={section}
          index={index}
          count={sections.length}
          armed={armed}
          actions={actions}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={onAddSection}
        disabled={sections.length >= MAX_SECTIONS}
        className="w-full"
        title={
          sections.length >= MAX_SECTIONS
            ? `A homepage may hold at most ${MAX_SECTIONS} sections`
            : "Add section"
        }
      >
        <Plus className="size-4" />
        Add section
      </Button>
    </div>
  );
}

function SectionRow({
  section,
  index,
  count,
  armed,
  actions,
}: {
  section: HomeSection;
  index: number;
  count: number;
  armed: string | null;
  actions: EditorActions;
}) {
  const columns = section.columns.length;
  const canAddColumn = columns < MAX_COLUMNS;

  return (
    <div className="flex items-start gap-2">
      <div className="flex w-8 shrink-0 flex-col items-center gap-1 pt-1 group">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="Section settings: background and padding"
          aria-label="Section settings: background and padding"
          onClick={() => actions.editSection(section.id)}
        >
          <Palette className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!canAddColumn}
          title={
            canAddColumn
              ? "Add a column to this section"
              : `Sections hold at most ${MAX_COLUMNS} columns`
          }
          aria-label="Add a column to this section"
          onClick={() => actions.addColumn(section.id)}
        >
          <Columns3 className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={index === 0}
          title="Move section up"
          aria-label="Move section up"
          onClick={() => actions.moveSection(section.id, -1)}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={index === count - 1}
          title="Move section down"
          aria-label="Move section down"
          onClick={() => actions.moveSection(section.id, 1)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
        <ConfirmIconButton
          label="Delete section"
          icon={Trash2}
          onConfirm={() => actions.removeSection(section.id)}
          className="text-destructive hover:text-destructive"
        />
      </div>

      <div
        className="min-w-0 flex-1 rounded-lg border bg-card p-3 shadow-xs"
        style={sectionTint(section)}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">
            Section {index + 1} of {count}
          </span>
          <span>
            {columns} {columns === 1 ? "column" : "columns"}
            {section.background.kind === "solid" && ` · ${section.background.color}`}
            {section.background.kind === "image" && " · image background"}
            {section.background.kind === "image" && ` · ${section.background.overlay}% dark`}
            {section.padding !== "none" && ` · ${section.padding} padding`}
          </span>
        </div>

        <div className={columnGridClass(columns)}>
          {section.columns.map((column) => (
            <ColumnSlot
              key={column.id}
              column={column}
              armed={armed}
              actions={actions}
              canRemove={columns > 1}
              onInsert={() => actions.insertElement(column.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Equal columns, stacking on small screens — the editor's copy of the storefront grid. */
function columnGridClass(count: number): string {
  return cn("grid grid-cols-1 gap-3", {
    "sm:grid-cols-1": count === 1,
    "sm:grid-cols-2": count === 2,
    "sm:grid-cols-3": count === 3,
    "sm:grid-cols-4": count >= 4,
  });
}

/**
 * Preview a solid background in the canvas so colour and padding are visible while editing.
 *
 * Image backgrounds are deliberately not painted here: a photo behind the editor's own
 * controls makes the chrome unreadable, and the settings dialog shows which image is set.
 */
function sectionTint(section: HomeSection): CSSProperties | undefined {
  const background: HomeBackground = section.background;
  if (background.kind !== "solid") return undefined;

  const color = String(background.color ?? "");
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)
    ? { backgroundColor: color }
    : undefined;
}

/** Padding labels for the settings dialog, kept beside the class names they map to. */
export const PADDING_LABELS: Record<HomePadding, string> = {
  none: "None",
  sm: "Small",
  md: "Medium",
  lg: "Large",
};
