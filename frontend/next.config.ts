import type { NextConfig } from "next";

// Dev and prod both run in a container over the same bind-mounted source, and `next dev` takes an
// exclusive PID lock inside its build directory while `next build` rewrites that directory wholesale.
// Sharing one distDir between them means a mode switch fails with "Another next dev server is
// already running", or serves a half-written production build.
//
// So: dev builds into .next-docker, prod into .next. The split also lines up with compose, which
// bind-mounts ./.next so a production build's output and cache survive a container recreate.
//
// Keyed on DEV, not DOCKER_MODE. DOCKER_MODE answers "is the frontend in the compose stack", which
// is true for both modes; keying the build directory off it sent production builds to
// .next-docker, where nothing persists them.
const distDir = process.env.DEV === "true" ? ".next-docker" : ".next";

// The API returns image paths as root-relative ("/uploads/x.svg"), because in single-origin
// Docker mode nginx serves both the app and /uploads from one host and a relative path needs no
// configuration.
//
// Standalone mode breaks that assumption: the browser is on :3000, where Next serves the app but
// nothing else, while /uploads lives on nginx. A card image would 404 there. Rewriting /uploads
// onto the API origin fixes it without the API having to emit absolute URLs, which would then be
// wrong for anyone fronting the stack with a different hostname.
// Gated on DOCKER_MODE, not just on NEXT_PUBLIC_API_URL being set. In Docker mode "localhost"
// from inside the frontend container is the container itself, so a rewrite aimed at
// http://localhost/uploads would point the server at its own port 80. nginx serves /uploads
// before Next ever sees the request so it never fires, but leaving it armed would turn any
// future /uploads fallthrough into a self-proxy. A stray NEXT_PUBLIC_API_URL — a .env.local
// copied over from split mode will have one — must not silently switch it on.
const inDocker = process.env.DOCKER_MODE === "true";
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
const apiOrigin =
  !inDocker && /^https?:\/\//.test(apiBase) ? new URL(apiBase).origin : null;

// `tw-animate-css` ships an exports map with a single `style` condition and no `default`:
//
//     "exports": { ".": { "style": "./dist/tw-animate.css" } }
//
// `next dev` resolves a CSS `@import` with `style` enabled, so it works and the enter/exit
// animation utilities are present. `next build` does not enable that condition for CSS, so the
// bare specifier fails to resolve and the production build dies before emitting anything:
//
//     Error: Module not found: Can't resolve 'tw-animate-css'
//
// This is a packaging bug in the dependency, not a misconfiguration here, and there is no version
// of the import that avoids it — an `exports` map also blocks reaching the file by subpath
// (`tw-animate-css/dist/tw-animate.css`), because only "." and "./prefix" are exported. Aliasing
// the bare specifier to the concrete file the `style` condition already names sidesteps the map
// entirely and is what that condition pointed at anyway.
//
// Verified to be a restoration rather than a change: a build with and without this alias emits
// byte-for-byte the same CSS apart from exactly +14,880 bytes, which is the whole of
// tw-animate-css's dist file — its `@utility` definitions, `@keyframes enter`/`exit` and
// `@custom-variant data-open`. Nothing else moved.
//
// Not removable, either: `shadcn/tailwind.css` defines 24 utilities but none of the enter/exit
// family, so without this package the select and dropdown-menu animations have no definitions to
// expand from.
const nextConfig: NextConfig = {
  distDir,
  turbopack: {
    resolveAlias: {
      "tw-animate-css": "./node_modules/tw-animate-css/dist/tw-animate.css",
    },
  },
  ...(apiOrigin
    ? {
        async rewrites() {
          return [
            { source: "/uploads/:path*", destination: `${apiOrigin}/uploads/:path*` },
          ];
        },
      }
    : {}),
};

export default nextConfig;