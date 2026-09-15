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
          chunk.source = addLegacyCssFallbacks(flattenCssLayers(source));
        } else if (source instanceof Uint8Array) {
          chunk.source = addLegacyCssFallbacks(flattenCssLayers(new TextDecoder().decode(source)));
        }
      }
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Legacy-browser CSS fallbacks (Samsung Tizen 5.5 / Chromium 69, old mobile
 * Safari, and anything else from the pre-2020 era).
 *
 * Tailwind v4 already ships rgba() fallbacks for its color-mix() usage, but
 * two constructs still break on Chromium 69-class engines:
 *
 *   1. @property rules (Chrome 85+). Without them, `var(--tw-border-style)`
 *      etc. resolve to nothing, so every `.border-*` utility renders with
 *      `border-style: none` and borders disappear entirely.
 *   2. :where()-wrapped rules (Chrome 88+). Tailwind's spacing utilities
 *      (space-y-*, space-x-*) and parts of preflight compile to
 *      `:where(.space-y-4>:not(:last-child))` — the whole rule is dropped
 *      by engines that don't know :where().
 *
 * Every engine that lacks color-mix() also lacks both of the above, so one
 * feature test gates the generated block — modern browsers never evaluate
 * it, legacy browsers get:
 *   1. :root custom-property declarations mirroring every @property
 *      initial-value, and
 *   2. unwrapped duplicates of every top-level :where(...) rule.
 *
 * (styles.css carries the matching hand-written fallbacks for the `inset`
 * shorthand, flex `gap` and `aspect-ratio` utilities.)
 * ══════════════════════════════════════════════════════════════════════════ */

const LEGACY_SUPPORTS_CONDITION = "(color: color-mix(in oklab, red 50%, transparent))";

function addLegacyCssFallbacks(css: string): string {
  // @property → :root initial-value fallbacks inside the legacy block.
  const propertyFallbacks: string[] = [];
  const propertyRe = /@property\s+(--[\w-]+)\s*\{[^}]*?initial-value\s*:\s*([^;}]+)\s*;?[^}]*\}/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = propertyRe.exec(css))) {
    propertyFallbacks.push(`${pMatch[1]}:${pMatch[2].trim()}`);
  }

  // Ensure at least border-style and common transform variables exist even
  // if @property was already stripped or not present — otherwise borders
  // disappear on Chromium 69.
  const essentialFallbacks = [
    "--tw-border-style:solid",
    "--tw-translate-x:0",
    "--tw-translate-y:0",
    "--tw-scale-x:1",
    "--tw-scale-y:1",
    "--tw-rotate-x:initial",
    "--tw-rotate-y:initial",
    "--tw-rotate-z:initial",
    "--tw-skew-x:initial",
    "--tw-skew-y:initial",
  ];
  for (const essential of essentialFallbacks) {
    const name = essential.split(":")[0];
    if (!propertyFallbacks.some((f) => f.startsWith(name + ":"))) {
      propertyFallbacks.push(essential);
    }
  }

  // Unwrapped duplicates of top-level :where(...) rules (space-y-*, the
  // preflight element selectors) inside the legacy block. Rules whose
  // selector still contains :is(/:where(/:lang( after unwrapping are
  // skipped — they would remain invalid on the old parser.
  const whereDuplicates: string[] = [];
  const ruleRe = /(^|\})\s*(?:@media[^{]+\{)?\s*([^{}@]+?)\s*\{([^{}]*)(?=\})/g;
  let rMatch: RegExpExecArray | null;
  while ((rMatch = ruleRe.exec(css))) {
    const selector = rMatch[2].trim();
    if (!selector.startsWith(":where(")) continue;
    let depth = 0;
    let end = -1;
    for (let i = ":where(".length - 1; i < selector.length; i++) {
      if (selector[i] === "(") depth++;
      else if (selector[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const inner = selector.slice(":where(".length, end);
    const rest = selector.slice(end + 1).trim();
    const unwrapped = `${inner}${rest ? ` ${rest}` : ""}`.trim();
    if (/:is\(|:where\(|:lang\(|:-webkit-any\(|:-moz-any\(/i.test(unwrapped)) continue;
    whereDuplicates.push(`${unwrapped}{${rMatch[3]}}`);
  }

  // The exact string "@supports not (color: color-mix(in oklab, red 50%, transparent))"
  // is what device-check.mjs looks for to confirm TV CSS compatibility.
  const legacyBlock = `\n@supports not ${LEGACY_SUPPORTS_CONDITION}{\n:root{${propertyFallbacks.join(";")};}\n${whereDuplicates.join("\n")}\n}\n`;
  const tvExtraFallback = `\n@supports not ${LEGACY_SUPPORTS_CONDITION}{:root{--tw-border-style:solid;--tw-translate-x:0;--tw-translate-y:0;--tw-scale-x:1;--tw-scale-y:1;}}\n`;
  return css + legacyBlock + tvExtraFallback;
}

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [flattenCssLayersPlugin()],
    server: {
      allowedHosts: true,
    },
    // Vite 8 transpiles with Oxc, and esbuild is only an optional peer
    // dependency now. `minify: "esbuild"` used to live here; on Vercel/CI
    // (npm install --legacy-peer-deps / bun — neither auto-installs peers)
    // esbuild is absent and the build died with
    //   "Failed to load `transformWithEsbuild` ... requires esbuild to be
    //    installed separately"
    // so no deploy could be produced at all. Never reintroduce esbuild here.
    //
    // Down-leveling is handled by Oxc instead:
    //   - oxc.target  → per-module transform, also what `vite dev` uses.
    //   - build.target → wins for the production bundle and is what keeps
    //     ES2020+ syntax (#private fields, ?., ??, class fields) out of the
    //     chunks — Chromium-69-class TVs fail to PARSE those and the page
    //     stays blank before React ever hydrates.
    //   - build.cssTarget → matches the TV's CSS engine for Lightning CSS.
    oxc: { target: "es2019" },
    build: {
      target: "es2019",
      cssTarget: "chrome49",
    },
  },
});
