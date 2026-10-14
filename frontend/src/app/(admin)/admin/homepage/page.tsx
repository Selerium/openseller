"use client";

import AuthGate from "@/components/auth-gate";
import HomepageEditor from "@/components/homepage/editor";

/**
 * The homepage editor.
 *
 * Full width rather than in the usual `Container`: this is a tool, not a list of records, and
 * the sidebar-plus-canvas layout needs the viewport. AuthGate handles the redirect for anyone
 * who is not signed in; requireAdmin on the API is what actually protects the data — a page
 * that merely hides its own controls is not an authorisation boundary.
 */
function HomepagePage() {
  return <HomepageEditor />;
}

export default function AdminHomepageRoute() {
  return (
    <AuthGate>
      <HomepagePage />
    </AuthGate>
  );
}
