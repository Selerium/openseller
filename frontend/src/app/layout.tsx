import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/lib/auth-context";
import { CartProvider } from "@/lib/cart-context";
import { Toaster } from "@/components/ui/sonner";
import SiteHeader from "@/components/layout/siteHeader";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Sample",
  description: "Sample platform",
};

/**
 * The shell.
 *
 * The header used to hang off the (shop) route group, so every route outside it — /, /login,
 * /register, /forgot-password — rendered bare, at its own width, with no way to the rest of the
 * app. It lives here now, above every route, and `main` is the flex column the pages fill.
 *
 * `min-h-dvh` rather than `min-h-screen`: on mobile, `screen` is the viewport as the *browser*
 * sees it, which is taller than what is visible once the URL bar is showing. A page centered
 * against `100vh` then sits low enough to hide its own submit button behind the bar.
 *
 * `main` is a flex column so a page can ask to be vertically centered — or to fill the viewport —
 * with `flex-1`, instead of hard-coding the header's height into a `100vh` calculation that
 * breaks the moment the header's size changes.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className="bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {/* Cart outside Auth on purpose: a cart belongs to the browser, not to a session, so it
              has to be able to render for a guest and survive logging in or out. */}
          <CartProvider>
            <AuthProvider>
              <div className="flex min-h-dvh flex-col">
                <SiteHeader />
                <main className="flex flex-1 flex-col">{children}</main>
              </div>
            </AuthProvider>
          </CartProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
