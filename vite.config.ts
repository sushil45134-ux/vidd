// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { Plugin } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * Tailwind v4 emits every utility inside `@layer { ... }`. Chromium 69
 * (Samsung Tizen 5.5) drops unknown at-rules, so the entire stylesheet
 * vanishes. Unwrap layers at build time; cascade order is preserved because
 * we emit the inner rules in the same sequence they were authored.
 */
function flattenCssLayers(css: string): string {
  css = css.replace(/@layer\s+[^{;]+;/g, "");

  const unwrap = (input: string): string => {
    let out = "";
    let i = 0;
    while (i < input.length) {
      const idx = input.indexOf("@layer", i);
      if (idx === -1) {
        out += input.slice(i);
        break;
      }
      out += input.slice(i, idx);
      let j = idx + 6;
      while (j < input.length && input[j] !== "{" && input[j] !== ";") j++;
      if (j >= input.length) {
        break;
      }
      if (input[j] === ";") {
        i = j + 1;
        continue;
      }
      let depth = 1;
      let k = j + 1;
      while (k < input.length && depth > 0) {
        const ch = input[k];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        k++;
      }
      out += unwrap(input.slice(j + 1, k - 1));
      i = k;
    }
    return out;
  };

  return unwrap(css);
}

function flattenCssLayersPlugin(): Plugin {
  return {
    name: "flatten-css-layers",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "asset") continue;
        const name = chunk.fileName;
        if (!name.endsWith(".css")) continue;
        const source = chunk.source;
        if (typeof source === "string") {
          chunk.source = flattenCssLayers(source);
        } else if (source instanceof Uint8Array) {
          chunk.source = flattenCssLayers(new TextDecoder().decode(source));
        }
      }
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [flattenCssLayersPlugin()],
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
