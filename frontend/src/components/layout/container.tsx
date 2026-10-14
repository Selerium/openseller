import { cn } from "@/lib/utils";

/**
 * The one page width.
 *
 * Every route used to spell its own wrapper — `mx-auto max-w-[1400px] px-4` in the header,
 * `max-w-350` on the cart (which is the same 1400px written as a spacing step), `max-w-2xl` on
 * the profile forms — so "how wide is this app" had as many answers as there were pages, and a
 * change to the shell meant finding all of them.
 *
 * One definition now. `cn` merges Tailwind classes, so a page that genuinely wants to be
 * narrower overrides the cap rather than replacing the wrapper: <Container className="max-w-2xl">.
 * That keeps forms from stretching the length of the screen while still aligning their gutters
 * with the header's.
 */
export default function Container({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[1400px] px-4", className)} {...props} />;
}