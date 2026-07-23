// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Samsung Tizen / older Smart TV browsers ship Chromium 47–76. Lower the
// JS + CSS baselines so Vite/esbuild down-transpile optional chaining,
// nullish coalescing, class fields, etc., and so Lightning CSS emits
// older CSS where possible. Runtime polyfills for missing web APIs load
// from src/lib/legacy-polyfills.ts.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    build: {
      target: ["chrome49", "safari11", "es2016"],
      cssTarget: ["chrome49", "safari11"],
    },
  },
});
