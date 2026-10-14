/**
 * The homepage tree, as the editor and the storefront both see it.
 *
 * Mirrors `backend/src/lib/homepage.ts`, which is what actually validates the document —
 * these types say what the TypeScript thinks, the backend says what the database accepts, and
 * a shape that disagrees between them fails at the save rather than rendering badly later.
 *
 * Ids are generated here, in the browser, which is why they cannot be `crypto.randomUUID()`
 * alone: that is a secure-context API and this app is expected to run over plain http on a
 * self-hosted LAN. `newUuid()` in lib/idempotency.ts carries the fallback.
 */

/** Every preset the sidebar can insert. New presets extend this union and nothing else. */
export type ElementKind =
  | "hero"
  | "heading"
  | "image"
  | "button"
  | "products"
  | "categories"
  | "contact_form";

export type HomePadding = "none" | "sm" | "md" | "lg";

export type HomeBackground =
  | { kind: "none" }
  | { kind: "solid"; color: string }
  | { kind: "image"; url: string; overlay: number };

export interface HomeElement {
  id: string;
  kind: ElementKind;
  fields: Record<string, unknown>;
}

export interface HomeColumn {
  id: string;
  elements: HomeElement[];
}

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
 * Structural caps, mirroring the backend's. The editor enforces them so the buttons that
 * would exceed them stop being available rather than submitting a tree the server refuses.
 */
export const MAX_SECTIONS = 40;
export const MAX_COLUMNS = 4;
export const MAX_ELEMENTS = 30;

/** What a brand-new homepage is: no sections. The storefront treats this as "never built". */
export const EMPTY_LAYOUT: HomeLayout = { version: 1, sections: [] };

/**
 * Every structural edit the canvas can perform, as one object.
 *
 * Defined beside the tree rather than beside the component that implements it: the section,
 * column and element components all take it, and their handlers differ only in which ids they
 * are given. One interface keeps the three files in agreement and keeps the editor component
 * free to change how it stores the tree without a matching edit in every leaf.
 *
 * The ids are what each callback needs to locate its target:
 *
 *   - insertElement needs the column (the sidebar's armed kind is the editor's own state)
 *   - remove/move/edit an element need section, column and element
 *   - section-level operations need the section only
 *   - removeColumn needs the column id; its two refusals (populated column, the section's
 *     last one) live in the action so no caller can route around them
 */
export interface EditorActions {
  insertElement: (columnId: string) => void;
  editElement: (elementId: string) => void;
  removeElement: (elementId: string) => void;
  moveElement: (elementId: string, delta: 1 | -1) => void;
  editSection: (sectionId: string) => void;
  removeSection: (sectionId: string) => void;
  moveSection: (sectionId: string, delta: 1 | -1) => void;
  addColumn: (sectionId: string) => void;
  removeColumn: (columnId: string) => void;
}

/**
 * The handshake the editor's preview uses to show the draft instead of the published page.
 *
 * The preview is a real iframe of `/`, and `/` fetches what is published — but the draft
 * cannot be fetched: it lives in the editor's state and in the admin-only draft PUT. So the
 * page inside the frame asks for it (`homepage-preview-request`), the editor answers with the
 * whole tree (`homepage-preview`), and the editor pushes it again on every change while the
 * frame is open. The page asks first because a message posted before its own listener exists
 * is simply lost, and there is no queue to recover it.
 *
 * postMessage rather than a query string or localStorage: the tree can be far larger than a
 * URL should carry, it must not outlive the preview in shared storage, and the origin/source
 * checks both receivers perform are what stop any other page from handing the storefront a
 * layout to render.
 */
export type PreviewMessage =
  | { kind: "homepage-preview-request" }
  | { kind: "homepage-preview"; layout: HomeLayout };

/**
 * Narrow a raw postMessage payload to a `PreviewMessage`.
 *
 * A structural check only — origin and source are each caller's to verify, since only the
 * caller knows which window it is willing to trust. The layout half checks for `sections`
 * rather than the full tree: the sender is the editor on the same origin, and RenderLayout
 * already treats an element it does not recognise as a gap rather than a crash.
 */
export function isPreviewMessage(data: unknown): data is PreviewMessage {
  if (typeof data !== "object" || data === null) return false;

  const kind = (data as { kind?: unknown }).kind;
  if (kind === "homepage-preview-request") return true;
  if (kind !== "homepage-preview") return false;

  const layout = (data as { layout?: unknown }).layout;
  return (
    typeof layout === "object" &&
    layout !== null &&
    Array.isArray((layout as { sections?: unknown }).sections)
  );
}
