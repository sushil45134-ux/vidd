/**
 * TV engine check — real Chromium, but with the **JavaScript feature set of
 * Samsung Tizen 5.5 (Chromium 69)** taken away.
 *
 * Why this exists: `device-check.mjs` only spoofs the User-Agent. The engine
 * is still a current Chromium, so `isTvBrowser()` paths run against APIs a
 * real Tizen TV does not have — the test can never fail, and the TV breaks in
 * the living room instead.
 *
 * This script:
 *   A. "Chrome 69 API diet"
 *      Removes every API that Chromium 69 lacks (Object.hasOwn, Array.at,
 *      String.replaceAll, Promise.allSettled, structuredClone, globalThis, …)
 *      BEFORE any page script runs, then loads the site and drives it:
 *      hydrate → open a card → press Play. tvBoot.ts has to put all of those
 *      APIs back; anything it misses surfaces here as a page error.
 *   B. "module bundle blocked"
 *      Simulates a TV where the ES-module bundle never executes (pre-module
 *      Tizen 2.4/3.0, dead download, parse failure). The page must still show
 *      the server-rendered poster library with working D-pad links.
 *   C. static parse check
 *      Parses every inline <script> in the served HTML (those are NOT
 *      transpiled by the build — TanStack injects them) and every referenced
 *      JS asset with an ES2019 grammar. Chromium 69 dies on `?.`, `??`,
 *      numeric separators and top-level await, and an inline parse error kills
 *      the whole script that would have hydrated the page.
 *
 * Usage:
 *   node scripts/tv-engine-check.mjs <url> [--out DIR] [--wait MS]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const outDir = resolve(
  args.includes("--out") ? args[args.indexOf("--out") + 1] : "./tv-engine-out",
);
const waitMs = Number(args.includes("--wait") ? args[args.indexOf("--wait") + 1] : 12000);
if (!url) {
  console.error("usage: node scripts/tv-engine-check.mjs <url> [--out DIR] [--wait MS]");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const TIZEN_UA =
  "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.5 TV Safari/537.36";

/* ── APIs Chromium 69 (Tizen 5.5) really does NOT have ─────────────────── */
const MISSING_ON_CHROME_69 = {
  globals: ["globalThis", "structuredClone", "queueMicrotask", "reportError"],
  objects: [
    ["Object", "fromEntries"],
    ["Object", "hasOwn"],
    ["Object", "groupBy"],
    ["Map", "groupBy"],
    ["Promise", "allSettled"],
    ["Promise", "any"],
    ["Promise", "withResolvers"],
    ["Promise", "try"],
    ["Array", "fromAsync"],
    ["URL", "canParse"],
    ["AbortSignal", "timeout"],
    ["AbortSignal", "any"],
    ["WeakRef", undefined],
  ],
  protos: [
    ["Array", "at"],
    ["Array", "findLast"],
    ["Array", "findLastIndex"],
    ["Array", "toReversed"],
    ["Array", "toSorted"],
    ["Array", "toSpliced"],
    ["Array", "with"],
    ["Array", "group"],
    ["Array", "groupToMap"],
    ["String", "at"],
    ["String", "replaceAll"],
    ["String", "matchAll"],
    ["String", "isWellFormed"],
    ["String", "toWellFormed"],
    ["Element", "replaceChildren"],
    ["Element", "checkVisibility"],
  ],
  intl: [
    "Intl.RelativeTimeFormat",
    "Intl.ListFormat",
    "Intl.Locale",
    "Intl.DisplayNames",
    "Intl.Segmenter",
  ],
  misc: ["crypto.randomUUID", "navigator.share", "FinalizationRegistry"],
};

const scenarios = {};

async function newPage(browser, { blockModule = false } = {}) {
  const context = await browser.newContext({
    userAgent: TIZEN_UA,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(String(e && e.stack ? e.stack : e).slice(0, 1200)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 500));
  });
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`),
  );
  if (blockModule) {
    await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort("failed"));
  }
  await page.addInitScript(
    ([cfg]) => {
      const __MISSING__ = cfg;
      const fail = [];
      const del = (obj, name) => {
        if (!obj || !name) return;
        try {
          Object.defineProperty(obj, name, {
            value: undefined,
            configurable: true,
            writable: true,
          });
        } catch {
          try {
            obj[name] = undefined;
          } catch {
            fail.push(name);
          }
        }
      };
      for (const g of __MISSING__.globals) del(window, g);
      for (const [owner, name] of __MISSING__.objects) {
        if (!name) {
          del(window, owner);
        } else {
          del(window[owner], name);
        }
      }
      for (const [owner, name] of __MISSING__.protos) {
        const ctor = window[owner];
        if (ctor && ctor.prototype) del(ctor.prototype, name);
      }
      for (const path of __MISSING__.intl) {
        const [root, leaf] = path.split(".");
        del(window[root], leaf);
      }
      for (const path of __MISSING__.misc) {
        const [root, leaf] = path.split(".");
        del(window[root], leaf);
      }
      window.__TV_DOWNGRADE_FAILED__ = fail;
    },
    [MISSING_ON_CHROME_69],
  );
  return { context, page, errors, consoleErrors, failedRequests };
}

async function signals(page) {
  return page.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
    const imgs = [...document.querySelectorAll("img")];
    const focusables = document.querySelectorAll('a[href], button, [tabindex="0"]');
    return {
      title: document.title,
      htmlClass: document.documentElement.className,
      textLength: text.length,
      textStart: text.slice(0, 180),
      imgCount: imgs.length,
      imgLoaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      links: document.querySelectorAll("a[href]").length,
      buttons: document.querySelectorAll("button").length,
      focusables: focusables.length,
      hasErrorOverlay: !!document.querySelector("[data-tv-error-overlay], #tv-runtime-error"),
      hydrated:
        !!window.__reactContainer$ || document.querySelectorAll("[data-tsd-source]").length > 0,
      downgraded: window.__TV_DOWNGRADE_FAILED__ || null,
      globalThisRestored: typeof window.globalThis !== "undefined",
      objectHasOwnRestored: typeof Object.hasOwn === "function",
      arrayAtRestored: typeof Array.prototype.at === "function",
      promiseAllSettledRestored: typeof Promise.allSettled === "function",
      replaceAllRestored: typeof String.prototype.replaceAll === "function",
      randomUuidRestored: typeof (crypto && crypto.randomUUID) === "function",
      abortSignalTimeoutRestored:
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function",
    };
  });
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });

/* ── Scenario A: Chrome 69 API diet, full user journey ─────────────────── */
{
  const { page, errors, consoleErrors, failedRequests, context } = await newPage(browser);
  const result = { name: "chrome69-api-diet", steps: [] };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(waitMs);
    result.afterLoad = await signals(page);
    await page.screenshot({ path: join(outDir, "a1-after-load.png") });

    // Open the first card the way a remote would: focus it and press Enter.
    const firstCard = page.locator('a[href], button, [tabindex="0"]').first();
    if (await firstCard.count()) {
      await firstCard.focus().catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(4000);
      result.afterEnter = await signals(page);
      result.afterEnterActiveText = await page
        .evaluate(() =>
          ((document.activeElement && document.activeElement.textContent) || "")
            .trim()
            .slice(0, 120),
        )
        .catch(() => "");
    }

    // Try to reach a player: click the first element whose text is Play.
    const play = page.getByText(/^\s*(▶\s*)?play\s*$/i).first();
    if (await play.count().catch(() => 0)) {
      await play
        .click({ timeout: 5000 })
        .catch((e) => (result.playClickError = String(e).slice(0, 200)));
      await page.waitForTimeout(6000);
      result.afterPlay = await signals(page);
      result.iframeSrc = await page
        .evaluate(() =>
          [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src")).slice(0, 3),
        )
        .catch(() => []);
      result.videoPresent = await page
        .evaluate(() => !!document.querySelector("video"))
        .catch(() => false);
    }
    await page.screenshot({ path: join(outDir, "a2-after-play.png") });
  } catch (e) {
    result.fatalError = String(e).slice(0, 600);
  }
  result.pageErrors = errors;
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests.slice(0, 15);
  scenarios.A_downgraded_chromium = result;
  await context.close();
}

/* ── Scenario B: the module bundle never runs ──────────────────────────── */
{
  const { page, errors, consoleErrors, context } = await newPage(browser, { blockModule: true });
  const result = { name: "no-module-bundle" };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(Math.min(waitMs, 8000));
    result.afterLoad = await signals(page);
    await page.screenshot({ path: join(outDir, "b1-no-module.png") });
  } catch (e) {
    result.fatalError = String(e).slice(0, 400);
  }
  result.pageErrors = errors.slice(0, 5);
  result.consoleErrors = consoleErrors.slice(0, 5);
  scenarios.B_no_module_bundle = result;
  await context.close();
}

/* ── Scenario C: static parse check of served HTML + assets ────────────── */
{
  const result = { name: "static-parse-es2019", inlineScripts: [], assets: [], violations: [] };
  try {
    const res = await fetch(url, { headers: { "user-agent": TIZEN_UA } });
    const html = await res.text();
    let acorn;
    try {
      acorn = await import("acorn");
    } catch {
      result.skipped = "acorn is not installed (npm i --no-save acorn)";
    }
    const parse = (code, sourceType) => {
      if (!acorn) return "no-acorn";
      for (const v of [2019]) {
        try {
          acorn.parse(code, {
            ecmaVersion: v,
            sourceType,
            allowReturnOutsideFunction: true,
            allowAwaitOutsideFunction: false,
          });
          return "ok";
        } catch (e) {
          return e.message;
        }
      }
    };
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    inline.forEach((m, i) => {
      if (/\bsrc=/.test(m[1])) return;
      const body = m[2];
      const verdict = parse(body, "script");
      const entry = {
        index: i,
        id: /id="([^"]+)"/.exec(m[1])?.[1] ?? "",
        bytes: body.length,
        es2019: verdict,
        preview: body.replace(/\s+/g, " ").slice(0, 90),
      };
      result.inlineScripts.push(entry);
      if (verdict !== "ok")
        result.violations.push(
          `inline script #${i} (${entry.id || "no id"}): ${verdict} :: ${entry.preview}`,
        );
    });

    const assets = [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+\.js/g) ?? [])];
    for (const a of assets.slice(0, 60)) {
      const assetUrl = new URL(a, url).href;
      const code = await fetch(assetUrl, { headers: { "user-agent": TIZEN_UA } }).then((r) =>
        r.text(),
      );
      const verdict = parse(code, "module");
      result.assets.push({ asset: a, bytes: code.length, es2019: verdict });
      // A top-level `await` is ES2022: Chromium 69 fails the whole module.
      if (verdict !== "ok") result.violations.push(`asset ${a}: ${verdict}`);
      for (const [label, re] of [
        ["numeric separator (Chrome 75+)", /\b\d[\d_]*_\d/],
        ["class private field (Chrome 74+)", /[^\w.$#]#[A-Za-z_]\w*\s*[=(;]/],
      ]) {
        if (re.test(code)) result.violations.push(`asset ${a}: ${label}`);
      }
    }
    result.checkedInline = result.inlineScripts.length;
    result.checkedAssets = result.assets.length;
  } catch (e) {
    result.fatalError = String(e).slice(0, 400);
  }
  scenarios.C_static_parse = result;
}

await browser.close();
writeFileSync(join(outDir, "tv-engine-results.json"), JSON.stringify(scenarios, null, 2));

/* ── Report ───────────────────────────────────────────────────────────── */
const A = scenarios.A_downgraded_chromium;
const B = scenarios.B_no_module_bundle;
const C = scenarios.C_static_parse;
console.log("=========== A. Chromium-69 API diet (real engine, TV API set) ===========");
if (A.fatalError) console.log("FATAL:", A.fatalError);
console.log("page title:", A.afterLoad?.title);
console.log("html class:", A.afterLoad?.htmlClass);
console.log(
  "visible text bytes:",
  A.afterLoad?.textLength,
  "| imgs:",
  `${A.afterLoad?.imgLoaded}/${A.afterLoad?.imgCount}`,
);
console.log(
  "links:",
  A.afterLoad?.links,
  "buttons:",
  A.afterLoad?.buttons,
  "focusables:",
  A.afterLoad?.focusables,
);
console.log("text:", JSON.stringify(A.afterLoad?.textStart ?? ""));
console.log(
  "polyfill restore:",
  JSON.stringify({
    globalThis: A.afterLoad?.globalThisRestored,
    ObjectHasOwn: A.afterLoad?.objectHasOwnRestored,
    ArrayAt: A.afterLoad?.arrayAtRestored,
    PromiseAllSettled: A.afterLoad?.promiseAllSettledRestored,
    replaceAll: A.afterLoad?.replaceAllRestored,
    randomUUID: A.afterLoad?.randomUuidRestored,
    abortTimeout: A.afterLoad?.abortSignalTimeoutRestored,
  }),
);
console.log("error overlay present:", A.afterLoad?.hasErrorOverlay);
if (A.afterEnter)
  console.log(
    "after Enter -> text bytes:",
    A.afterEnter.textLength,
    "| overlay:",
    A.afterEnter.hasErrorOverlay,
    "| active:",
    JSON.stringify(A.afterEnterActiveText),
  );
if (A.afterPlay)
  console.log(
    "after Play  -> iframes:",
    JSON.stringify(A.iframeSrc),
    "| video tag:",
    A.videoPresent,
  );
console.log("page errors:", A.pageErrors.length);
A.pageErrors.slice(0, 8).forEach((e) => console.log("   ! " + e.split("\n")[0]));
console.log("console errors:", A.consoleErrors.length);
A.consoleErrors.slice(0, 8).forEach((e) => console.log("   ! " + e.slice(0, 220)));
console.log("failed requests:", A.failedRequests.length);
A.failedRequests.slice(0, 6).forEach((e) => console.log("   ! " + e.slice(0, 180)));

console.log("\n=========== B. module bundle blocked (pre-module TV) ===========");
if (B.fatalError) console.log("FATAL:", B.fatalError);
console.log(
  "visible text bytes:",
  B.afterLoad?.textLength,
  "| imgs:",
  `${B.afterLoad?.imgLoaded}/${B.afterLoad?.imgCount}`,
);
console.log("links:", B.afterLoad?.links, "focusables:", B.afterLoad?.focusables);
console.log("text:", JSON.stringify(B.afterLoad?.textStart ?? ""));
B.pageErrors.slice(0, 4).forEach((e) => console.log("   ! " + e.split("\n")[0]));

console.log("\n=========== C. static ES2019 parse of what the TV downloads ===========");
console.log(
  `inline scripts checked: ${C.checkedInline ?? "?"}, assets checked: ${C.checkedAssets ?? "?"}`,
);
if (C.skipped) console.log("SKIPPED:", C.skipped);
console.log("violations:", C.violations.length);
C.violations.slice(0, 20).forEach((v) => console.log("   ! " + v));
console.log(`\nraw results: ${join(outDir, "tv-engine-results.json")}`);
