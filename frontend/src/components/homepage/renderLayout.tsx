"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { ELEMENT_BY_KIND, iconFor, labelFor } from "./registry";
import type { HomeBackground, HomeElement, HomeLayout, HomePadding, HomeSection } from "./types";

/**
 * The one homepage renderer, used by both the storefront and the editor's preview.
 *
 * Same code path on purpose: a preview that re-implements the layout drifts from what ships,
 * and the whole point of a visual editor is that what you arranged is what you get.
 *
 * Two variants, which differ *only* in what they do with an element whose preset has no
 * renderer yet:
 *
 *   - "live"     renders nothing for it. Scaffolding must never reach a visitor.
 *   - "preview"  shows a labelled placeholder, so the editor can display the elements it
 *                holds before their presets exist.
 */

const PADDING: Record<HomePadding, string> = {
  none: "",
  sm: "py-4 md:py-6",
  md: "py-8 md:py-12",
  lg: "py-14 md:py-20",
};

/**
 * The section's vertical padding, on the `<section>` itself so a solid colour or image
 * background fills it — padding on the inner container would leave the background hugging
 * the content with a coloured gap below it.
 *
 * Falls back to the default for a section stored before padding was part of the document;
 * an unknown class name here would silently render the whole setting inert.
 */
function paddingClass(section: HomeSection): string {
  return PADDING[section.padding] ?? PADDING.md;
}

// Written as literals so Tailwind's scanner sees every value. Columns stack on small screens
// and split into equal halves, thirds or quarters from `sm` up — equal widths filling the
// section is the rule, and one empty cell per column is what keeps the widths right when a
// column has no elements in it yet.
const GRID: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

export interface RenderLayoutProps {
  layout: HomeLayout;
  variant?: "live" | "preview";
}

export default function RenderLayout({ layout, variant = "live" }: RenderLayoutProps) {
  if (layout.sections.length === 0) return null;

  return (
    <div className="w-full">
      {layout.sections.map((section) => (
        <SectionView key={section.id} section={section} variant={variant} />
      ))}
    </div>
  );
}

function SectionView({
  section,
  variant,
}: {
  section: HomeSection;
  variant: "live" | "preview";
}) {
  const content = (
    <div className="mx-auto w-full max-w-[1400px] px-4">
      <div
        className={cn(
          "grid grid-cols-1 gap-4 md:gap-6",
          GRID[section.columns.length] ?? "sm:grid-cols-1",
        )}
      >
        {section.columns.map((column) => (
          // One cell per column even when it is empty: dropping the cell would reflow the
          // grid and the remaining columns would no longer be equal widths.
          <div key={column.id} className="min-w-0 space-y-4">
            {column.elements.map((element) => (
              <ElementView key={element.id} element={element} variant={variant} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  if (section.background.kind === "image") {
    const url = String(section.background.url ?? "");
    // Clamped here rather than trusted: the value is validated on save, but this component is
    // also handed whatever is in the database, and a CSS string built from an unchecked value
    // is the one thing in this tree worth double-checking. The number is formatted by
    // arithmetic, never interpolated from the document.
    const overlay = Math.min(100, Math.max(0, Number(section.background.overlay) || 0)) / 100;

    return (
      <section className={cn("relative isolate overflow-hidden", paddingClass(section))}>
        {url && (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgba(0,0,0,${overlay})` }}
        />
        <div className="relative">{content}</div>
      </section>
    );
  }

  return (
    <section
      className={cn(section.background.kind === "solid" && "isolate", paddingClass(section))}
      style={solidStyle(section.background)}
    >
      {content}
    </section>
  );
}

/** Hex guard for the colour picker's output. Anything else renders as no background. */
function solidStyle(background: HomeBackground): CSSProperties | undefined {
  if (background.kind !== "solid") return undefined;
  const color = String(background.color ?? "");
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)
    ? { backgroundColor: color }
    : undefined;
}

function ElementView({
  element,
  variant,
}: {
  element: HomeElement;
  variant: "live" | "preview";
}) {
  const def = ELEMENT_BY_KIND[element.kind];
  const Renderer = def?.Render;

  if (Renderer) return <Renderer fields={element.fields} />;
  if (variant === "preview") return <UnbuiltPlaceholder kind={element.kind} />;
  return null;
}

function UnbuiltPlaceholder({ kind }: { kind: string }) {
  const Icon = iconFor(kind);

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
      <Icon className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{labelFor(kind)}</p>
      <p className="text-xs text-muted-foreground">
        Placeholder — this element's editor and storefront render arrive with its preset.
      </p>
    </div>
  );
}
