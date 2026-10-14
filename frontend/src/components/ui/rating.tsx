import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingProps {
  /** 0-5, may be fractional. */
  value: number;
  className?: string;
  /** Star size in Tailwind units. */
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: "size-3",
  md: "size-3.5",
  lg: "size-4",
} as const;

/**
 * Read-only star rating.
 *
 * Half stars are drawn by overlaying a clipped copy of the filled row on an empty row rather
 * than by rounding to a whole star. Rounding would make a 4.4 average display as 4 stars while
 * the number beside it says 4.4, so the two halves of the same row would disagree.
 *
 * The overlay is positioned and inset to match the empty row exactly, and both rows are
 * aria-hidden: the rating is announced from the adjacent text instead, which is a number a
 * screen reader can actually convey, rather than five repeated star glyphs.
 */
export function Rating({ value, className, size = "sm" }: RatingProps) {
  const clamped = Math.min(5, Math.max(0, value));
  const percent = (clamped / 5) * 100;
  const starClass = SIZES[size];

  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      role="img"
      aria-label={`Rated ${clamped.toFixed(1)} out of 5`}
    >
      {/* empty track */}
      <span className="flex gap-0.5 text-muted-foreground/30" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className={cn(starClass, "fill-current")} strokeWidth={0} />
        ))}
      </span>
      {/* filled overlay, clipped to the rating */}
      <span
        className="absolute inset-0 flex gap-0.5 overflow-hidden text-amber-500"
        style={{ width: `${percent}%` }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className={cn(starClass, "shrink-0 fill-current")} strokeWidth={0} />
        ))}
      </span>
    </span>
  );
}