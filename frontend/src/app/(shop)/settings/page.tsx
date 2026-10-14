import { redirect } from "next/navigation";

/**
 * /settings is only a doorway.
 *
 * The three settings are separate routes, because a sidebar that scrolls to anchors on one page
 * and links to routes on another is worse than either. Sending /settings to the first section
 * means the header dropdown's existing "Settings" link still lands somewhere real, and no
 * bookmark to /settings can end up on a page that no longer exists.
 *
 * A server redirect rather than a client one: this component has no interactivity, and doing it
 * during render means the section is in the URL before anything paints.
 */
export default function SettingsIndex() {
  redirect("/settings/password");
}
