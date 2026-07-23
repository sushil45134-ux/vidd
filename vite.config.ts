// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// NOTE: @vitejs/plugin-legacy conflicts with TanStack Start's start-manifest
// plugin ("multiple entries detected"). Instead we down-transpile the client
// bundle via build.target and load polyfills at runtime in
// src/lib/legacy-polyfills.ts so optional chaining / nullish coalescing and
// missing APIs (ResizeObserver, IntersectionObserver, Promise.allSettled)
// work on Samsung Tizen / older Smart TV Chromium engines.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    build: {
      target: ["chrome60", "safari11", "es2017"],
      cssTarget: ["chrome60", "safari11"],
    },
  },
});
