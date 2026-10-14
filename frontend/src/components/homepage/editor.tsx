"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Eye, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { newUuid, outcomeUnknown } from "@/lib/idempotency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import ElementDialog from "./elementDialog";
import ElementSidebar from "./elementSidebar";
import PreviewFrame from "./previewFrame";
import { ELEMENT_BY_KIND } from "./registry";
import SectionSettingsDialog from "./sectionSettings";
import SectionStack from "./sectionStack";
import type {
  EditorActions,
  ElementKind,
  HomeElement,
  HomeLayout,
  HomeSection,
} from "./types";

/** What GET/PUT /admin/homepage and the two POSTs return. */
interface HomepageState {
  draft: HomeLayout;
  published: HomeLayout | null;
  dirty: boolean;
  updatedAt: string;
}

const LOAD_ERROR = "Could not load the homepage editor.";

const serialize = (tree: HomeLayout) => JSON.stringify({ layout: tree });

/**
 * The homepage editor.
 *
 * Three ideas hold it together:
 *
 *   1. **The tree in React is the truth.** Every structural change builds a new tree, hands it
 *      to `commit`, and the canvas renders from it. Nothing waits for the server, so add,
 *      delete and reorder are immediate; the server is told afterwards.
 *
 *   2. **Saves are serialized.** A PUT is never sent while another is in flight — the next
 *      one waits for it and then sends the *latest* tree. That is what makes one idempotency
 *      key per intent safe: a key is only reused while its outcome is unknown, and two
 *      different trees are never in flight together under the same key.
 *
 *   3. **Dirty is the server's answer, not a guess.** The API compares draft to published
 *      over documents that came out of jsonb in a canonical key order and returns the result.
 *      Comparing two trees in the browser would disagree with reality often enough to make
 *      the Publish button lie.
 *
 * The draft goes live only when Publish says so, which is why this is two documents and not
 * one: a visitor can never be shown a half-built page.
 */
export default function HomepageEditor() {
  const [layout, setLayout] = useState<HomeLayout | null>(null);
  const [hasPublished, setHasPublished] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [armed, setArmed] = useState<ElementKind | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<"publish" | "discard" | null>(null);

  // --- save machinery ------------------------------------------------------
  //
  // Refs, not state, for everything an in-flight request reads: a closure over state captures
  // the tree as it was when the request was scheduled, and the point is to send the tree as
  // it is *now*. Everything below reads refs, so a slightly stale closure is still correct.
  const layoutRef = useRef<HomeLayout | null>(null);
  const savedRef = useRef<string>(""); // last tree the server accepted
  const keyRef = useRef<string | null>(null); // idempotency key of the current intent
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  async function flush(): Promise<void> {
    // Wait out a save already running. Two PUTs of the same tree at once would race, and the
    // second would be a different intent that needs a different key.
    while (inFlight.current) {
      await inFlight.current;
    }

    const tree = layoutRef.current;
    if (!tree) return;

    const body = serialize(tree);
    if (body === savedRef.current) return;

    if (keyRef.current === null) keyRef.current = newUuid();
    const key = keyRef.current;
    setSaveState("saving");

    const run = (async () => {
      try {
        const res = await api<HomepageState>("/admin/homepage", {
          method: "PUT",
          body,
          idempotencyKey: key,
        });
        keyRef.current = null;
        savedRef.current = body;
        setDirty(res.data.dirty);
        setSaveState("saved");
      } catch (error) {
        // A 4xx is a definite answer, so the intent is spent and the next save is a new one.
        // A network failure or a 5xx is an unknown outcome: the key stays, so a retry asks
        // "did that already happen?" instead of doing it again.
        if (!outcomeUnknown(error)) keyRef.current = null;
        setSaveState("error");
      }
    })();

    inFlight.current = run;
    try {
      await run;
    } finally {
      if (inFlight.current === run) inFlight.current = null;

      // Send again only if something *beyond what this request carried* is waiting. Resending
      // unconditionally would turn one persistent failure into a retry loop, which is exactly
      // what the error state is there to stop and hand to the admin.
      if (layoutRef.current && serialize(layoutRef.current) !== body) {
        schedule(0);
      }
    }
  }

  function schedule(delay = 600): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, delay);
  }

  function commit(next: HomeLayout): void {
    layoutRef.current = next;
    setLayout(next);
    // Optimistic. Until the server compares draft to published we do not know whether this
    // edit differs from what is live, and claiming "up to date" for a change that has not
    // landed would be worse than a badge that settles a moment later.
    setDirty(true);
    schedule();
  }

  /** Adopt a server response wholesale — after load, publish or discard. */
  function applyState(state: HomepageState): void {
    layoutRef.current = state.draft;
    savedRef.current = serialize(state.draft);
    setLayout(state.draft);
    setHasPublished(state.published !== null);
    setDirty(state.dirty);
  }

  async function load(): Promise<void> {
    setLoadError(null);
    setLoading(true);
    try {
      applyState((await api<HomepageState>("/admin/homepage")).data);
    } catch (error) {
      setLoadError(error instanceof Error && error.message ? error.message : LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape is one way out of insert mode; a click anywhere that is neither the sidebar nor a
  // column is the other, so the arm cannot get stuck on an admin who changed their mind and
  // just started clicking around. Both the sidebar button and the column overlay are exempt,
  // which is also what keeps the click that *set* the arm from clearing it again.
  useEffect(() => {
    if (!armed) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArmed(null);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-arming], [data-insert-target]")) return;
      setArmed(null);
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [armed]);

  // --- tree editing --------------------------------------------------------

  function mutateSections(
    fn: (sections: HomeLayout["sections"]) => HomeLayout["sections"],
  ): void {
    const tree = layoutRef.current;
    if (!tree) return;
    commit({ ...tree, sections: fn(tree.sections) });
  }

  const editingElement = locateElement(layout, editingId);
  const settingsSection = locateSection(layout, settingsId);

  const actions: EditorActions = {
    insertElement: (columnId) => {
      const kind = armed;
      if (!kind) return;
      const fields = JSON.parse(JSON.stringify(ELEMENT_BY_KIND[kind].defaults)) as Record<
        string,
        unknown
      >;

      mutateSections((sections) =>
        sections.map((section) =>
          section.columns.some((column) => column.id === columnId)
            ? {
                ...section,
                columns: section.columns.map((column) =>
                  column.id === columnId
                    ? {
                        ...column,
                        elements: [
                          ...column.elements,
                          { id: newUuid(), kind, fields },
                        ],
                      }
                    : column,
                ),
              }
            : section,
        ),
      );

      // One placement per arming: leaving it armed would make a second click on another
      // column an accidental duplicate.
      setArmed(null);
    },
    editElement: (elementId) => setEditingId(elementId),
    removeElement: (elementId) =>
      mutateSections((sections) =>
        sections.map((section) => ({
          ...section,
          columns: section.columns.map((column) => ({
            ...column,
            elements: column.elements.filter((element) => element.id !== elementId),
          })),
        })),
      ),
    moveElement: (elementId, delta) =>
      mutateSections((sections) =>
        sections.map((section) => ({
          ...section,
          columns: section.columns.map((column) => ({
            ...column,
            elements: moveWithin(column.elements, elementId, delta),
          })),
        })),
      ),
    editSection: (sectionId) => setSettingsId(sectionId),
    removeSection: (sectionId) =>
      mutateSections((sections) => sections.filter((section) => section.id !== sectionId)),
    moveSection: (sectionId, delta) =>
      mutateSections((sections) => {
        const index = sections.findIndex((section) => section.id === sectionId);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= sections.length) return sections;
        const next = [...sections];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      }),
    addColumn: (sectionId) =>
      mutateSections((sections) =>
        sections.map((section) =>
          section.id === sectionId && section.columns.length < 4
            ? { ...section, columns: [...section.columns, { id: newUuid(), elements: [] }] }
            : section,
        ),
      ),
    // Both refusals live here rather than only at the button: a populated column would take
    // its elements with it, and a columnless section is exactly the tree the backend refuses
    // (rawColumns.length === 0 in backend/src/lib/homepage.ts). Cheap to check, impossible
    // to route around.
    removeColumn: (columnId) =>
      mutateSections((sections) =>
        sections.map((section) => {
          const target = section.columns.find((column) => column.id === columnId);
          if (!target || target.elements.length > 0 || section.columns.length < 2) {
            return section;
          }
          return {
            ...section,
            columns: section.columns.filter((column) => column.id !== columnId),
          };
        }),
      ),
  };

  const addSection = () =>
    mutateSections((sections) => [
      ...sections,
      {
        id: newUuid(),
        background: { kind: "none" as const },
        padding: "md" as const,
        columns: [{ id: newUuid(), elements: [] }],
      },
    ]);

  const toggleArmed = (kind: ElementKind) =>
    setArmed((current) => (current === kind ? null : kind));

  const publish = async () => {
    setBusy("publish");
    try {
      // Nothing goes live until the draft on screen has been written: publishing the stored
      // draft while an edit is still queued would ship the previous version.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      await flush();

      // `flush` swallows its own failures into the save indicator, so check what it managed
      // rather than assuming. Without this a PUT that just failed would leave publish copying
      // the *previous* draft over `published` and calling it a success.
      if (layoutRef.current && serialize(layoutRef.current) !== savedRef.current) {
        throw new Error("The latest changes did not save, so nothing was published.");
      }

      applyState(
        (await api<HomepageState>("/admin/homepage/publish", {
          method: "POST",
          idempotencyKey: newUuid(),
        })).data,
      );
      setSaveState("saved");
      toast.success("Homepage published — it is live now");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish the homepage");
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("discard");
    try {
      applyState(
        (await api<HomepageState>("/admin/homepage/discard-draft", {
          method: "POST",
          idempotencyKey: newUuid(),
        })).data,
      );
      toast.success("Draft reset to the published homepage");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not discard the draft");
    } finally {
      setBusy(null);
    }
  };

  // --- render --------------------------------------------------------------

  if (loadError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  if (loading || !layout) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[75vh] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Homepage editor</h1>
          {dirty ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-600 dark:text-amber-400"
            >
              Unpublished changes
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Live
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SaveIndicator
            state={saveState}
            onRetry={() => {
              setSaveState("idle");
              void flush();
            }}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreviewing((value) => !value)}
            title={
              previewing
                ? "Back to the editor"
                : "Preview the draft — what visitors get once you publish"
            }
          >
            {previewing ? <Pencil className="size-4" /> : <Eye className="size-4" />}
            {previewing ? "Back to editor" : "Preview"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!dirty || !hasPublished || busy !== null}
            onClick={() => void discard()}
            title={
              hasPublished
                ? "Throw the draft away and start from what is published"
                : "Nothing is published yet, so there is nothing to discard"
            }
          >
            {busy === "discard" ? <Spinner className="size-4" /> : null}
            Discard changes
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={!dirty || busy !== null || saveState === "error"}
            onClick={() => void publish()}
            title={
              saveState === "error"
                ? "A save failed — retry it first, or this would publish the previous draft"
                : "Make the draft live"
            }
          >
            {busy === "publish" ? <Spinner className="size-4" /> : null}
            Publish
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {!previewing && <ElementSidebar armed={armed} onToggle={toggleArmed} />}

        <main className="min-w-0 flex-1 p-4">
          {previewing ? (
            <PreviewFrame layout={layout} onClose={() => setPreviewing(false)} />
          ) : layout.sections.length === 0 ? (
            <div className="mx-auto max-w-xl rounded-lg border border-dashed p-8 text-center">
              <h2 className="text-sm font-semibold">Your homepage is empty</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a section, give it a column, then place an element in the column. Visitors
                keep seeing the default home page until you publish.
              </p>
              <Button className="mt-4" onClick={addSection}>
                <Plus className="size-4" />
                Add the first section
              </Button>
            </div>
          ) : (
            <SectionStack
              sections={layout.sections}
              armed={armed}
              actions={actions}
              onAddSection={addSection}
            />
          )}
        </main>
      </div>

      <ElementDialog
        element={editingElement}
        onClose={() => setEditingId(null)}
        onSave={(fields) => {
          const target = editingId;
          if (!target) return;
          mutateSections((sections) =>
            sections.map((section) => ({
              ...section,
              columns: section.columns.map((column) => ({
                ...column,
                elements: column.elements.map((element) =>
                  element.id === target ? { ...element, fields } : element,
                ),
              })),
            })),
          );
        }}
      />

      <SectionSettingsDialog
        section={settingsSection}
        onClose={() => setSettingsId(null)}
        onSave={(patch) => {
          const target = settingsId;
          if (!target) return;
          mutateSections((sections) =>
            sections.map((section) => (section.id === target ? { ...section, ...patch } : section)),
          );
        }}
      />
    </div>
  );
}

/** Save state, as a chip beside the header buttons. */
function SaveIndicator({
  state,
  onRetry,
}: {
  state: "idle" | "saving" | "saved" | "error";
  onRetry: () => void;
}) {
  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        Saving…
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5 text-emerald-600" />
        Saved
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onRetry}
      className="flex items-center gap-1.5 text-xs text-destructive underline-offset-2 hover:underline"
      title="Click to retry the save"
    >
      <CircleAlert className="size-3.5" />
      Save failed — retry
    </button>
  );
}

function locateElement(
  layout: HomeLayout | null,
  elementId: string | null,
): HomeElement | null {
  if (!layout || !elementId) return null;
  for (const section of layout.sections) {
    for (const column of section.columns) {
      const found = column.elements.find((element) => element.id === elementId);
      if (found) return found;
    }
  }
  return null;
}

function locateSection(layout: HomeLayout | null, sectionId: string | null): HomeSection | null {
  if (!layout || !sectionId) return null;
  return layout.sections.find((section) => section.id === sectionId) ?? null;
}

/** Move one item within its own list, leaving every other position alone. */
function moveWithin<T extends { id: string }>(items: T[], id: string, delta: 1 | -1): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
