// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    server: {
      // Accept any host header so the app is reachable through sandbox/preview
      // proxies (dev server only — never used for the production build).
      allowedHosts: true,
    },
    // Samsung Tizen TVs are commonly a few browser generations behind
    // desktop Chrome. Transpile optional chaining, async syntax, etc. instead
    // of shipping Vite's modern-browser default bundle to those browsers.
    build: {
      target: "es2015",
    },
  },
});
