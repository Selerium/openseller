import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Image as ImageIcon,
  LayoutGrid,
  MousePointerClick,
  PackageSearch,
  Send,
  Sparkles,
  Type,
} from "lucide-react";
import {
  ButtonsForm,
  CategoriesForm,
  ContactFormForm,
  HeadingForm,
  HeroForm,
  ImageForm,
  ProductsForm,
} from "./elementForms";
import {
  ButtonRender,
  CategoriesRender,
  ContactFormRender,
  HeadingRender,
  HeroRender,
  ImageRender,
  ProductsRender,
} from "./elementRenders";
import type { ElementKind } from "./types";

/**
 * The element registry: one entry per preset, and the file that gives a preset its place.
 *
 * Each entry answers four questions for a kind — what it is called in the sidebar, what a
 * freshly inserted instance of it contains, how its fields are edited, and how it renders for
 * a visitor. The bodies for the last two live beside this file: `elementForms.tsx` holds every
 * edit form, `elementRenders.tsx` every storefront renderer, so adding a preset is a new entry
 * here plus its form and renderer over there. The backend keeps its own list of kinds
 * (ELEMENT_KINDS in backend/src/lib/homepage.ts) purely as an allowlist, so nothing here
 * reaches the database unchecked — no migration and no new endpoint either way.
 *
 * `Form` and `Render` stay optional: a preset can land as an entry with defaults alone, and
 * until its two components arrive it shows as a labelled placeholder in the editor's canvas
 * and renders as nothing at all on the storefront — scaffolding never reaches a visitor. All
 * seven kinds ship both.
 */
export interface ElementFormProps {
  fields: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export interface ElementRenderProps {
  fields: Record<string, unknown>;
}

export interface ElementDef {
  kind: ElementKind;
  /** Sidebar label. */
  label: string;
  /** One line under the label, so the sidebar explains itself without a tooltip. */
  hint: string;
  icon: LucideIcon;
  /**
   * The `fields` a new instance starts with. Also the contract the preset's form and
   * renderer read, so what lands in the tree today is what the next pass renders.
   */
  defaults: Record<string, unknown>;
  /** The edit modal's body. Absent until the preset is built. */
  Form?: ComponentType<ElementFormProps>;
  /** The storefront body. Absent until the preset is built. */
  Render?: ComponentType<ElementRenderProps>;
}

export const ELEMENTS: ElementDef[] = [
  {
    kind: "hero",
    label: "Hero",
    hint: "Image, headline, subtext and a button",
    icon: Sparkles,
    defaults: {
      heading: "A big statement",
      subtext: "",
      imageUrl: "",
      imageAlt: "",
      buttonLabel: "",
      buttonHref: "",
    },
    Form: HeroForm,
    Render: HeroRender,
  },
  {
    kind: "heading",
    label: "Heading & text",
    hint: "A title with a paragraph under it",
    icon: Type,
    defaults: {
      title: "Section title",
      body: "",
    },
    Form: HeadingForm,
    Render: HeadingRender,
  },
  {
    kind: "image",
    label: "Image",
    hint: "One image, or a group of them",
    icon: ImageIcon,
    defaults: {
      images: [] as string[],
      alt: "",
      caption: "",
    },
    Form: ImageForm,
    Render: ImageRender,
  },
  {
    kind: "button",
    label: "Button",
    hint: "One or more calls to action",
    icon: MousePointerClick,
    defaults: {
      buttons: [{ label: "Browse the marketplace", href: "/marketplace" }],
    },
    Form: ButtonsForm,
    Render: ButtonRender,
  },
  {
    kind: "products",
    label: "Product grid",
    hint: "Featured or newest products from the catalog",
    icon: PackageSearch,
    defaults: {
      title: "Popular right now",
      source: "newest",
      limit: 8,
    },
    Form: ProductsForm,
    Render: ProductsRender,
  },
  {
    kind: "categories",
    label: "Category grid",
    hint: "Category tiles that link into the marketplace",
    icon: LayoutGrid,
    defaults: {
      title: "Shop by category",
      limit: 8,
    },
    Form: CategoriesForm,
    Render: CategoriesRender,
  },
  {
    kind: "contact_form",
    label: "Contact form",
    hint: "Name, email, number and a description",
    icon: Send,
    defaults: {
      title: "Get in touch",
      intro: "",
      // Where a submitted message is delivered. Empty until the admin sets it, which is what
      // keeps the storefront from offering a submit that has nowhere to go — see
      // ContactFormRender in elementRenders.tsx.
      to: "",
      submitLabel: "Send message",
      // The inputs are data rather than hard-coded markup: the preset renders whatever is in
      // here, so labels, order and whether a field is required stay editable by the admin.
      inputs: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "number", label: "Number", type: "text", required: false },
        { key: "requestDescription", label: "Request description", type: "textarea", required: true },
      ],
    },
    Form: ContactFormForm,
    Render: ContactFormRender,
  },
];

export const ELEMENT_BY_KIND: Record<ElementKind, ElementDef> = Object.fromEntries(
  ELEMENTS.map((def) => [def.kind, def]),
) as Record<ElementKind, ElementDef>;

/** Icon for an element instance, falling back to a generic box for an unknown kind. */
export function iconFor(kind: string): LucideIcon {
  return ELEMENT_BY_KIND[kind as ElementKind]?.icon ?? LayoutGrid;
}

/** Label for an element instance, falling back to the raw kind. */
export function labelFor(kind: string): string {
  return ELEMENT_BY_KIND[kind as ElementKind]?.label ?? kind;
}
