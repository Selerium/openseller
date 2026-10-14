"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ELEMENT_BY_KIND, labelFor } from "./registry";
import type { ElementFormProps } from "./registry";
import type { HomeElement } from "./types";

/**
 * The edit modal behind an element's pencil icon.
 *
 * One dialog for every kind of element: it owns the open/close lifecycle, the local copy of
 * the fields, and the save button, and hands the body to the kind's own form. That is the
 * whole contract a preset needs to satisfy — provide a `Form` component and this file needs
 * no change, which is what keeps adding an element to a single new registry entry.
 *
 * Until a kind has a form, the dialog still opens, and says so plainly next to a read-only
 * list of what the element currently holds. An icon that opens an empty modal reads as
 * broken; an icon that opens a modal explaining the preset is on its way does not.
 *
 * Fields are edited locally and written back on Save, so autosave does not PUT a
 * half-typed headline. Everything structural — inserts, deletes, moves — is saved at once,
 * but a text field is only worth saving once the person typing it has let go.
 */
export default function ElementDialog({
  element,
  onClose,
  onSave,
}: {
  element: HomeElement | null;
  onClose: () => void;
  onSave: (fields: Record<string, unknown>) => void;
}) {
  const elementId = element?.id;
  const [fields, setFields] = useState<Record<string, unknown>>({});

  // Resync when a different element is opened, not on every render of the same one: the tree
  // is replaced by every structural change, and following that identity would discard a
  // half-typed edit each time something elsewhere changed.
  useEffect(() => {
    setFields(elementId ? (element?.fields ?? {}) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId]);

  const def = element ? ELEMENT_BY_KIND[element.kind] : undefined;
  const Form = def?.Form;
  const label = element ? labelFor(element.kind) : "element";

  return (
    <Dialog open={element !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {label.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {Form
              ? "Changes are saved to the draft when you press Save, and go live when you publish."
              : "This element is in place, but its editor arrives with its preset."}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body rather than a growing dialog: the list presets hold up to eight
            rows of controls, and a fixed, centred modal whose footer slides off the bottom of
            the screen is a modal you cannot press Save on. Header and footer stay put. */}
        <div className="-mx-1 max-h-[55vh] overflow-y-auto px-1">
          {Form ? (
            <Form fields={fields} onChange={setFields} />
          ) : (
            <NotReady kind={element?.kind ?? ""} label={label} fields={fields} />
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {Form ? "Cancel" : "Close"}
          </Button>
          {Form && (
            <Button
              type="button"
              onClick={() => {
                onSave(fields);
                onClose();
              }}
            >
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the admin sees while a preset has no form yet.
 *
 * The field list is real data rather than a mock — it is the element's current `fields` —
 * so the dialog answers "what does this thing hold" instead of only "you cannot edit this".
 */
function NotReady({
  kind,
  label,
  fields,
}: {
  kind: string;
  label: string;
  fields: Record<string, unknown>;
}) {
  const def = ELEMENT_BY_KIND[kind as keyof typeof ELEMENT_BY_KIND];
  const entries = Object.entries(fields);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        The editing form for <span className="font-medium text-foreground">{label}</span> is part
        of the element presets. Until then this element sits in the column with its default
        content and renders nothing on the storefront.
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          This element currently holds
        </p>
        <dl className="divide-y rounded-lg border">
          {entries.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Nothing yet.</div>
          )}
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-3 px-3 py-2 text-sm">
              <dt className="w-32 shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-words">{describe(value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {def && (
        <p className="text-xs text-muted-foreground">
          Defaults come from the registry: <code>{def.kind}</code>.
        </p>
      )}
    </div>
  );
}

/** Readable one-liner for a field value of unknown shape. */
function describe(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const json = JSON.stringify(value);
  return json.length > 160 ? `${json.slice(0, 160)}…` : json;
}
