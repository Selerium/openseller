"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import ImagePicker from "./imagePicker";
import {
  PRODUCT_SORTS,
  count,
  productSort,
  readButtons,
  readContactInputs,
  readStringList,
  text,
  type ButtonEntry,
  type ContactInputEntry,
  type ContactInputType,
} from "./fields";
import type { ElementFormProps } from "./registry";

/**
 * The edit body for every element preset.
 *
 * The dialog (elementDialog.tsx) owns the open/close lifecycle, the local copy of `fields`
 * and the Save button; each form here is a controlled editor over that copy — read the
 * fields, report the change, never save anything itself. That is what keeps an autosave PUT
 * from firing on every keystroke of a half-typed headline.
 *
 * Every field reads through the shared readers in fields.ts, so what the form shows for a
 * missing or malformed value is exactly what the storefront renderer will show for it.
 * Structural limits (how many images, buttons, inputs) are enforced here, where the buttons
 * that would exceed them can simply stop being available.
 */

const MAX_IMAGES = 8;
const MAX_BUTTONS = 4;
const MAX_INPUTS = 8;

/** Where the contact form's message is delivered — see the field's hint in ContactFormForm. */
const DESTINATION_HINT =
  "Messages open in the visitor's own mail app, addressed to this address. Until one is set, " +
  "the form tells visitors that sending is unavailable.";

// --- shared field primitives ---------------------------------------------

function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TextAreaField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Whole numbers only, clamped as they are typed.
 *
 * Clamping in the change handler rather than on save means the stored value is never a
 * half-entered one: clearing the box falls back to the minimum, so a document written by a
 * key press mid-edit still parses on the server.
 */
function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min);
        }}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The small heading over a repeatable list, with its count when a cap applies. */
function ListHeader({ label, used, max }: { label: string; used?: number; max?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {used !== undefined && max !== undefined && (
        <span className="text-xs text-muted-foreground">
          {used} / {max}
        </span>
      )}
    </div>
  );
}

const listShell =
  "rounded-lg border border-border bg-muted/20 p-3 space-y-3";

// --- hero -----------------------------------------------------------------

export function HeroForm({ fields, onChange }: ElementFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-5">
      <TextField
        label="Heading"
        value={text(fields.heading)}
        onChange={(next) => set("heading", next)}
        placeholder="A big statement"
      />
      <TextAreaField
        label="Subtext"
        hint="A line or two under the heading. Leave it empty for a heading-only hero."
        value={text(fields.subtext)}
        onChange={(next) => set("subtext", next)}
      />

      <div className="space-y-2">
        <Label>Image</Label>
        <ImagePicker
          label="Hero image"
          value={text(fields.imageUrl)}
          onChange={(url) => set("imageUrl", url)}
        />
        <p className="text-xs text-muted-foreground">
          Shown above the heading. Leave it empty for a text-only hero.
        </p>
      </div>

      <TextField
        label="Image description"
        hint="Read aloud to visitors who cannot see the image."
        value={text(fields.imageAlt)}
        onChange={(next) => set("imageAlt", next)}
        placeholder="Describe the image"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Button label"
          hint="Empty hides the button."
          value={text(fields.buttonLabel)}
          onChange={(next) => set("buttonLabel", next)}
          placeholder="Browse the marketplace"
        />
        <TextField
          label="Button link"
          hint="A site path or an https:// address."
          value={text(fields.buttonHref)}
          onChange={(next) => set("buttonHref", next)}
          placeholder="/marketplace"
        />
      </div>
    </div>
  );
}

// --- heading ---------------------------------------------------------------

export function HeadingForm({ fields, onChange }: ElementFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-5">
      <TextField
        label="Title"
        value={text(fields.title)}
        onChange={(next) => set("title", next)}
        placeholder="Section title"
      />
      <TextAreaField
        label="Body"
        hint="The paragraph under the title. Line breaks are kept."
        value={text(fields.body)}
        onChange={(next) => set("body", next)}
      />
    </div>
  );
}

// --- image -----------------------------------------------------------------

export function ImageForm({ fields, onChange }: ElementFormProps) {
  const images = readStringList(fields.images);
  const update = (next: string[]) => onChange({ ...fields, images: next });
  const set = (key: string, value: unknown) => onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <ListHeader label="Images" used={images.length} max={MAX_IMAGES} />

        {images.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            No images yet — add the first one below.
          </p>
        )}

        {images.map((url, index) => (
          <div key={index} className={listShell}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Image {index + 1}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                title="Remove image"
                aria-label={`Remove image ${index + 1}`}
                onClick={() => update(images.filter((_, position) => position !== index))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <ImagePicker
              label={`Image ${index + 1}`}
              value={url}
              onChange={(next) =>
                update(images.map((current, position) => (position === index ? next : current)))
              }
            />
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={images.length >= MAX_IMAGES}
          onClick={() => update([...images, ""])}
          title={images.length >= MAX_IMAGES ? `An image element holds at most ${MAX_IMAGES} images` : "Add image"}
        >
          <Plus className="size-4" />
          Add image
        </Button>
      </div>

      <TextField
        label="Description"
        hint="Read aloud to visitors who cannot see the images."
        value={text(fields.alt)}
        onChange={(next) => set("alt", next)}
        placeholder="Describe the images"
      />
      <TextField
        label="Caption"
        hint="Small line under the images. Optional."
        value={text(fields.caption)}
        onChange={(next) => set("caption", next)}
      />
    </div>
  );
}

// --- button ----------------------------------------------------------------

export function ButtonsForm({ fields, onChange }: ElementFormProps) {
  const buttons = readButtons(fields.buttons).slice(0, MAX_BUTTONS);
  const update = (next: ButtonEntry[]) => onChange({ ...fields, buttons: next });

  return (
    <div className="space-y-3">
      <ListHeader label="Buttons" used={buttons.length} max={MAX_BUTTONS} />

      {buttons.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No buttons yet — add one below.
        </p>
      )}

      {buttons.map((button, index) => (
        <div key={index} className={listShell}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Button {index + 1}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="Remove button"
              aria-label={`Remove button ${index + 1}`}
              onClick={() => update(buttons.filter((_, position) => position !== index))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>

          <TextField
            label="Label"
            value={button.label}
            onChange={(next) =>
              update(buttons.map((current, position) => (position === index ? { ...current, label: next } : current)))
            }
            placeholder="Browse the marketplace"
          />
          <TextField
            label="Link"
            hint="A site path or an https:// address."
            value={button.href}
            onChange={(next) =>
              update(buttons.map((current, position) => (position === index ? { ...current, href: next } : current)))
            }
            placeholder="/marketplace"
          />
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={buttons.length >= MAX_BUTTONS}
        onClick={() => update([...buttons, { label: "", href: "/marketplace" }])}
        title={buttons.length >= MAX_BUTTONS ? `This element holds at most ${MAX_BUTTONS} buttons` : "Add button"}
      >
        <Plus className="size-4" />
        Add button
      </Button>
    </div>
  );
}

// --- products --------------------------------------------------------------

export function ProductsForm({ fields, onChange }: ElementFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-5">
      <TextField
        label="Title"
        value={text(fields.title)}
        onChange={(next) => set("title", next)}
        placeholder="Popular right now"
      />
      <SelectField
        label="Order"
        hint="How the grid sorts the catalog."
        value={productSort(fields.source)}
        onChange={(next) => set("source", next)}
        options={PRODUCT_SORTS}
      />
      <NumberField
        label="How many products"
        hint="The grid pulls this many from the catalog, up to 12."
        value={count(fields.limit, 8, 1, 12)}
        onChange={(next) => set("limit", next)}
        min={1}
        max={12}
      />
    </div>
  );
}

// --- categories ------------------------------------------------------------

export function CategoriesForm({ fields, onChange }: ElementFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-5">
      <TextField
        label="Title"
        value={text(fields.title)}
        onChange={(next) => set("title", next)}
        placeholder="Shop by category"
      />
      <NumberField
        label="How many categories"
        hint="The grid shows this many tiles, up to 12."
        value={count(fields.limit, 8, 1, 12)}
        onChange={(next) => set("limit", next)}
        min={1}
        max={12}
      />
    </div>
  );
}

// --- contact form ----------------------------------------------------------

/**
 * Derive an input's `key` (its name in the stored data) from its label.
 *
 * Re-derived on every label edit so the stored keys always say what the field is — "Request
 * description" becomes `request_description`, not the `field3` it would get if keys were only
 * minted when the row was added. `taken` holds the *other* rows' keys: including this row's
 * own would make every save rename it again the moment the label matched it exactly.
 */
function deriveKey(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^[^a-z]+/, "")
      .slice(0, 32) || "field";

  let key = base;
  let suffix = 2;
  while (taken.includes(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  return key;
}

export function ContactFormForm({ fields, onChange }: ElementFormProps) {
  const listId = useId();
  const inputs = readContactInputs(fields.inputs).slice(0, MAX_INPUTS);
  const set = (key: string, value: unknown) => onChange({ ...fields, [key]: value });
  const update = (next: ContactInputEntry[]) => onChange({ ...fields, inputs: next });

  const typeOptions: { value: ContactInputType; label: string }[] = [
    { value: "text", label: "Short text" },
    { value: "email", label: "Email address" },
    { value: "tel", label: "Phone number" },
    { value: "number", label: "Number" },
    { value: "textarea", label: "Long text" },
  ];

  return (
    <div className="space-y-5">
      <TextField
        label="Title"
        value={text(fields.title)}
        onChange={(next) => set("title", next)}
        placeholder="Get in touch"
      />
      <TextAreaField
        label="Intro"
        hint="A line above the fields. Optional."
        value={text(fields.intro)}
        onChange={(next) => set("intro", next)}
      />
      <TextField
        label="Send messages to"
        hint={DESTINATION_HINT}
        value={text(fields.to)}
        onChange={(next) => set("to", next)}
        placeholder="you@example.com"
      />
      <TextField
        label="Submit label"
        value={text(fields.submitLabel)}
        onChange={(next) => set("submitLabel", next)}
        placeholder="Send message"
      />

      <div className="space-y-3">
        <ListHeader label="Fields" used={inputs.length} max={MAX_INPUTS} />

        {inputs.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            No fields yet — add one below.
          </p>
        )}

        {inputs.map((input, index) => {
          const requiredId = `${listId}-required-${index}`;
          const others = inputs
            .filter((_, position) => position !== index)
            .map((entry) => entry.key);

          return (
            <div key={index} className={listShell}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Field {index + 1}
                </span>
                <div className="flex items-center gap-3">
                  <Label htmlFor={requiredId} className="text-xs text-muted-foreground">
                    Required
                    <Switch
                      id={requiredId}
                      checked={input.required}
                      onCheckedChange={(checked) =>
                        update(
                          inputs.map((current, position) =>
                            position === index ? { ...current, required: checked } : current,
                          ),
                        )
                      }
                    />
                  </Label>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="Remove field"
                    aria-label={`Remove field ${index + 1}`}
                    onClick={() => update(inputs.filter((_, position) => position !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              <TextField
                label="Label"
                value={input.label}
                onChange={(next) =>
                  update(
                    inputs.map((current, position) =>
                      position === index
                        ? { ...current, label: next, key: deriveKey(next, others) }
                        : current,
                    ),
                  )
                }
                placeholder="Name"
              />
              <SelectField
                label="Type"
                value={input.type}
                onChange={(next) =>
                  update(
                    inputs.map((current, position) =>
                      position === index ? { ...current, type: next as ContactInputType } : current,
                    ),
                  )
                }
                options={typeOptions}
              />
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={inputs.length >= MAX_INPUTS}
          onClick={() =>
            update([
              ...inputs,
              { key: deriveKey("", inputs.map((entry) => entry.key)), label: "", type: "text", required: false },
            ])
          }
          title={inputs.length >= MAX_INPUTS ? `A contact form holds at most ${MAX_INPUTS} fields` : "Add field"}
        >
          <Plus className="size-4" />
          Add field
        </Button>
      </div>

      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        The inputs are data, not fixed markup: labels, order and which fields are required are
        all read from this list when the page renders.
      </p>
    </div>
  );
}
