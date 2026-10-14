"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import ImagePicker from "./imagePicker";
import type { HomeBackground, HomePadding, HomeSection } from "./types";

/**
 * Section settings: the background and the vertical padding.
 *
 * Held in local state and applied on Save rather than written through on every control,
 * because the background is a sequence of steps — pick "image", then choose the image, then
 * set the darkening — and each of those would otherwise be a separate PUT of a section that
 * is half-configured. The tree's structural changes save immediately; a form does not.
 */
export default function SectionSettingsDialog({
  section,
  onClose,
  onSave,
}: {
  section: HomeSection | null;
  onClose: () => void;
  onSave: (patch: { background: HomeBackground; padding: HomePadding }) => void;
}) {
  const sectionId = section?.id;
  const [background, setBackground] = useState<HomeBackground>({ kind: "none" });
  const [padding, setPadding] = useState<HomePadding>("md");

  useEffect(() => {
    if (section) {
      setBackground(section.background);
      setPadding(section.padding);
    }
    // Resync on opening a different section, not on every tree change — the autosave PUT
    // returns a new object identity for the same section, and following that would throw
    // away what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  // Narrowed inline in the JSX below rather than through a pre-computed `kind` variable:
  // `background.kind === "solid" && …` is a type guard, so `background.color` is safe inside
  // the branch, while an earlier boolean would not narrow anything.
  return (
    <Dialog open={section !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Section settings</DialogTitle>
          <DialogDescription>
            Background and spacing for this section. Saved with everything else when you press
            Save.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="section-background">Background</Label>
            <Select
              value={background.kind}
              onValueChange={(value) =>
                setBackground(
                  value === "solid"
                    ? { kind: "solid", color: "#111827" }
                    : value === "image"
                      ? { kind: "image", url: "", overlay: 40 }
                      : { kind: "none" },
                )
              }
            >
              <SelectTrigger id="section-background" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="solid">Solid colour</SelectItem>
                <SelectItem value="image">Image with a dark overlay</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {background.kind === "solid" && (
            <div className="space-y-2">
              <Label htmlFor="section-colour">Colour</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Colour picker"
                  value={/^#[0-9a-fA-F]{6}$/.test(background.color) ? background.color : "#111827"}
                  onChange={(event) =>
                    setBackground({ kind: "solid", color: event.target.value })
                  }
                  className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <Input
                  id="section-colour"
                  value={background.color}
                  onChange={(event) =>
                    setBackground({ kind: "solid", color: event.target.value })
                  }
                  placeholder="#111827"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                A hex colour such as <code>#111827</code>.
              </p>
            </div>
          )}

          {background.kind === "image" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Background image</Label>
                <ImagePicker
                  label="Background image"
                  value={background.url}
                  onChange={(url) => setBackground({ ...background, url })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="section-overlay">Darkening · {Math.round(background.overlay)}%</Label>
                <input
                  id="section-overlay"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={background.overlay}
                  onChange={(event) =>
                    setBackground({
                      ...background,
                      overlay: Number(event.target.value),
                    })
                  }
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground">
                  How much black sits over the image, so text on top of it stays readable.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="section-padding">Vertical padding</Label>
            <Select value={padding} onValueChange={(value) => setPadding(value as HomePadding)}>
              <SelectTrigger id="section-padding" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — content edge to edge</SelectItem>
                <SelectItem value="sm">Small</SelectItem>
                <SelectItem value="md">Medium</SelectItem>
                <SelectItem value="lg">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave({ background, padding });
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
