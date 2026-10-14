import AppError from "./appError.ts";

/**
 * The homepage tree: the shape of everything that travels between the editor, the two
 * homepage endpoints, and the storefront renderer.
 *
 * One definition in one file because the three have to agree exactly. The frontend keeps a
 * TypeScript copy in `frontend/src/components/homepage/types.ts`; this one is what actually
 * decides what reaches the database, so it validates rather than trusts.
 *
 * The tree is client-authored. Every function below either returns a cleaned copy or throws
 * an AppError, and cleaning means *dropping* keys it does not recognise rather than passing
 * them through: a JSONB column has no schema, so junk written today is junk every storefront
 * render pays for forever.
 */

export interface HomeElement {
  id: string;
  kind: string;
  fields: Record<string, unknown>;
}

export interface HomeColumn {
  id: string;
  elements: HomeElement[];
}

export type HomePadding = "none" | "sm" | "md" | "lg";

export type HomeBackground =
  | { kind: "none" }
  | { kind: "solid"; color: string }
  | { kind: "image"; url: string; overlay: number };

export interface HomeSection {
  id: string;
  background: HomeBackground;
  padding: HomePadding;
  columns: HomeColumn[];
}

export interface HomeLayout {
  version: 1;
  sections: HomeSection[];
}

/**
 * Element kinds the editor may insert.
 *
 * The frontend registry (`frontend/src/components/homepage/registry.tsx`) owns the label,
 * icon, default fields, edit form and storefront renderer for each of these. Keep the two in
 * sync: an unknown kind is rejected by PUT, so a preset added to the registry but not here
 * shows up as a failed save in the editor rather than as silent junk in the page.
 *
 * When the presets land, this is the only line that changes for each new one.
 */
export const ELEMENT_KINDS = new Set([
  "hero",
  "heading",
  "image",
  "button",
  "products",
  "categories",
  "contact_form",
]);

// Structural caps. Chosen to be far above anything a real page needs and low enough that a
// hostile or looping client cannot make the storefront render a tree with a million nodes.
export const MAX_SECTIONS = 40;
export const MAX_COLUMNS = 4;
export const MAX_ELEMENTS = 30;

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const KIND_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const MAX_STRING = 8000;
const MAX_URL = 2048;
const MAX_FIELD_DEPTH = 4;
const MAX_FIELD_ITEMS = 200;

const PADDING = new Set<HomePadding>(["none", "sm", "md", "lg"]);

/** What an empty homepage is: no sections at all, which the storefront treats as "never built". */
export const EMPTY_LAYOUT: HomeLayout = { version: 1, sections: [] };

/**
 * Primary key of the one row this feature has.
 *
 * A constant rather than a generated uuid because the row is a singleton, and a generated id
 * would make two concurrent first requests create two rows and then each keep reading its own
 * — the fixed key turns that race into a primary-key conflict, where exactly one insert wins
 * and the loser simply finds the winner's row.
 */
export const HOMEPAGE_ID = "singleton";

function fail(message: string): never {
  // 400, not 422: nothing here is field-specific, and the editor never submits anything the
  // user could correct by typing differently. The message names the offending part.
  throw new AppError(message, 400);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function readString(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") fail(`${what} must be a string`);
  if (value.length > max) fail(`${what} is longer than ${max} characters`);
  return value;
}

/**
 * Image URLs are rendered in an `<img src>`, so they are restricted to an absolute URL or a
 * same-origin path. `javascript:` and `data:` are the two schemes worth refusing; neither
 * executes from an img in a current browser, but refusing them costs nothing and means no
 * renderer downstream has to think about it.
 */
function readUrl(value: unknown, what: string): string {
  const url = readString(value, MAX_URL, what);
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    fail(`${what} must be an http(s) URL or a site-relative path`);
  }
  return url;
}

function readId(value: unknown, what: string): string {
  const id = readString(value, 64, what);
  if (!ID_RE.test(id)) fail(`${what} is not a valid id`);
  return id;
}

/**
 * Recursively bounds one element's `fields`.
 *
 * Bounded rather than merely type-checked: an element config that nests ten deep or carries
 * two hundred thousand keys costs nothing to send and everything to render, and the storefront
 * has no way to refuse a tree it already agreed to serve.
 */
function normalizeValue(value: unknown, depth: number, path: string): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
      if (value.length > MAX_STRING) fail(`${path} is longer than ${MAX_STRING} characters`);
      return value;
    case "number":
      // NaN and Infinity do not survive JSON, but a body parser bug or a future non-JSON
      // transport would, and JSONB cannot store them in the first place.
      if (!Number.isFinite(value)) fail(`${path} must be a finite number`);
      return value;
    case "boolean":
      return value;
    case "object": {
      if (depth > MAX_FIELD_DEPTH) fail(`${path} is nested too deeply`);
      if (Array.isArray(value)) {
        if (value.length > MAX_FIELD_ITEMS) fail(`${path} has too many items`);
        return value.map((item, index) => normalizeValue(item, depth + 1, `${path}[${index}]`));
      }
      if (!isPlainObject(value)) fail(`${path} must be a plain object`);
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (!FIELD_KEY_RE.test(key)) fail(`${path} has an invalid field name "${key}"`);
        out[key] = normalizeValue(item, depth + 1, `${path}.${key}`);
      }
      return out;
    }
    default:
      // undefined, function, symbol, bigint. None of these arrive from JSON.parse, so this
      // branch is unreachable over the wire — it exists so a test calling this directly with
      // a hand-built object gets an error instead of a silent drop.
      fail(`${path} has an unsupported value`);
  }
}

function parseFields(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) fail(`${path} fields must be an object`);
  return normalizeValue(value, 0, `${path} fields`) as Record<string, unknown>;
}

function parseElement(value: unknown, path: string): HomeElement {
  if (!isPlainObject(value)) fail(`${path} must be an object`);

  const kind = readString(value.kind, 40, `${path} kind`);
  if (!KIND_RE.test(kind)) fail(`${path} has an invalid kind "${kind}"`);
  if (!ELEMENT_KINDS.has(kind)) {
    throw new AppError(`Unknown element type "${kind}"`, 400, {
      kind,
      known: [...ELEMENT_KINDS],
    });
  }

  return {
    id: readId(value.id, `${path} id`),
    kind,
    fields: parseFields(value.fields, path),
  };
}

function parseColumn(value: unknown, index: number): HomeColumn {
  const path = `column ${index}`;
  if (!isPlainObject(value)) fail(`${path} must be an object`);

  const rawElements = value.elements ?? [];
  if (!Array.isArray(rawElements)) fail(`${path} elements must be an array`);
  if (rawElements.length > MAX_ELEMENTS) {
    fail(`${path} has more than ${MAX_ELEMENTS} elements`);
  }

  return {
    id: readId(value.id, `${path} id`),
    elements: rawElements.map((element, position) => parseElement(element, `${path} element ${position}`)),
  };
}

function parseBackground(value: unknown): HomeBackground {
  if (value === undefined || value === null) return { kind: "none" };
  if (!isPlainObject(value)) fail("section background must be an object");

  const kind = value.kind;
  if (kind === undefined || kind === "none") return { kind: "none" };

  if (kind === "solid") {
    const color = readString(value.color, 32, "background color");
    if (!HEX_COLOR_RE.test(color)) fail("background color must be a hex color like #1f2937");
    return { kind: "solid", color };
  }

  if (kind === "image") {
    const url = readUrl(value.url, "background image");
    const overlay = value.overlay === undefined ? 0 : Number(value.overlay);
    if (!Number.isFinite(overlay) || overlay < 0 || overlay > 100) {
      fail("background overlay must be between 0 and 100");
    }
    return { kind: "image", url, overlay };
  }

  fail("section background must be none, solid or image");
}

function parsePadding(value: unknown): HomePadding {
  if (value === undefined) return "md";
  if (typeof value !== "string" || !PADDING.has(value as HomePadding)) {
    fail("section padding must be one of none, sm, md or lg");
  }
  return value as HomePadding;
}

function parseSection(value: unknown, index: number): HomeSection {
  const path = `section ${index}`;
  if (!isPlainObject(value)) fail(`${path} must be an object`);

  const rawColumns = value.columns ?? [];
  if (!Array.isArray(rawColumns)) fail(`${path} columns must be an array`);
  if (rawColumns.length === 0) fail(`${path} has no columns`);
  if (rawColumns.length > MAX_COLUMNS) {
    fail(`${path} has more than ${MAX_COLUMNS} columns`);
  }

  return {
    id: readId(value.id, `${path} id`),
    background: parseBackground(value.background),
    padding: parsePadding(value.padding),
    columns: rawColumns.map((column, position) => parseColumn(column, position)),
  };
}

/**
 * Validate an untrusted tree and return a cleaned copy containing only recognised keys.
 *
 * Accepts the shape as JSON presents it — `version` is checked rather than defaulted, because
 * a tree from a future editor must be refused by an API that cannot render it rather than
 * stored and served to visitors.
 */
export function parseLayout(value: unknown): HomeLayout {
  if (!isPlainObject(value)) fail("layout must be an object");
  if (value.version !== 1) fail("unsupported layout version");

  const rawSections = value.sections ?? [];
  if (!Array.isArray(rawSections)) fail("layout sections must be an array");
  if (rawSections.length > MAX_SECTIONS) {
    fail(`layout has more than ${MAX_SECTIONS} sections`);
  }

  return {
    version: 1,
    sections: rawSections.map((section, index) => parseSection(section, index)),
  };
}

/**
 * True when the JSON read back out of the `published` column is still a layout this API would
 * accept. The storefront uses this to fall back to its placeholder instead of 500-ing on a
 * document written by a version of the editor that no longer exists.
 */
export function isRenderable(value: unknown): value is HomeLayout {
  try {
    parseLayout(value);
    return true;
  } catch {
    return false;
  }
}
