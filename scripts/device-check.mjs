/**
 * Device compatibility check: loads a URL in real Chromium under several
 * device profiles (Samsung Tizen TV, Android phone, old iOS Safari) and
 * records console errors, failed requests, page errors, screenshots and
 * basic render signals (hero text, row count, image count).
 *
 * Usage:
 *   node scripts/device-check.mjs <url> [--out DIR] [--wait MS]
 *
 * Playwright must be installed separately (CI does this; local sandboxes
 * usually cannot download Chromium):
 *   npm install --no-save playwright && npx playwright install chromium
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const outDir = resolve(
  args.includes("--out") ? args[args.indexOf("--out") + 1] : "./device-check-out",
);
const waitMs = Number(args.includes("--wait") ? args[args.indexOf("--wait") + 1] : 10000);
if (!url) {
  console.error("usage: node scripts/device-check.mjs <url> [--out DIR] [--wait MS]");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const PROFILES = {
  tv_tizen_5_5: {
    label: "Samsung Tizen 5.5 TV (Chromium 69-era)",
    userAgent:
      "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.5 TV Safari/537.36",
    viewport: { width: 1280, height: 720 },
  },
  tv_tizen_old: {
    label: "Older SMART-TV browser (pre-Tizen UA)",
    userAgent:
      "Mozilla/5.0 (SMART-TV; X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.112 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  },
  phone_android: {
    label: "Android phone (Chrome 120)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2.625,
  },
  phone_ios_old: {
    label: "Old iPhone (iOS 12 Safari)",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
};

const summary = { url, startedAt: new Date().toISOString(), profiles: {} };
let failures = 0;

const browser = await chromium.launch();
for (const [name, profile] of Object.entries(PROFILES)) {
  const result = {
    label: profile.label,
    userAgent: profile.userAgent,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    renderSignals: {},
    timings: {},
  };
  const context = await browser.newContext({
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    deviceScaleFactor: profile.deviceScaleFactor,
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") result.consoleErrors.push(text.slice(0, 2000));
    else if (msg.type() === "warning") result.consoleWarnings.push(text.slice(0, 1000));
  });
  page.on("pageerror", (err) => result.pageErrors.push(String(err?.stack || err).slice(0, 3000)));
  page.on("requestfailed", (req) =>
    result.failedRequests.push(
      `${req.method()} ${req.url()} — ${req.failure()?.errorText || "failed"}`,
    ),
  );

  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    result.timings.domContentLoadedMs = Date.now() - started;
  } catch (err) {
    result.timings.gotoError = String(err).slice(0, 2000);
    result.consoleErrors.push(`goto failed: ${String(err).slice(0, 500)}`);
  }

  try {
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(waitMs);
    result.timings.settledMs = Date.now() - started;

    result.renderSignals = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("h2, h1"));
      const bodyText = (document.body?.innerText || "").slice(0, 600);
      return {
        title: document.title,
        htmlClass: document.documentElement.className,
        bodyChildCount: document.body ? document.body.children.length : 0,
        textLength: (document.body?.innerText || "").length,
        imgCount: document.images.length,
        imgLoadedCount: Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 0)
          .length,
        buttons: document.querySelectorAll("button").length,
        headingCount: rows.length,
        firstHeadings: rows.slice(0, 6).map((h) => h.textContent?.trim()).filter(Boolean),
        bodyStart: bodyText.replace(/\n+/g, " | ").slice(0, 300),
        hasTvErrorOverlay: !!document.getElementById("tv-runtime-error"),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      };
    });
    await page.screenshot({
      path: resolve(outDir, `${name}.jpg`),
      type: "jpeg",
      quality: 72,
      fullPage: false,
    });
  } catch (err) {
    result.consoleErrors.push(`post-load check failed: ${String(err).slice(0, 500)}`);
  }

  const critical =
    result.pageErrors.length > 0 ||
    result.consoleErrors.length > 0 ||
    result.timings.gotoError ||
    (result.renderSignals.textLength || 0) < 200;
  if (critical) failures++;
  result.verdict = critical ? "PROBLEM" : "OK";
  summary.profiles[name] = result;
  console.log(`\n=== ${name} (${profile.label}): ${result.verdict} ===`);
  console.log(JSON.stringify({ ...result, consoleWarnings: undefined }, null, 2).slice(0, 6000));
  await context.close();
}
await browser.close();

summary.finishedAt = new Date().toISOString();
summary.verdict = failures === 0 ? "ALL OK" : `${failures} PROBLEM PROFILE(S)`;
writeFileSync(resolve(outDir, "results.json"), JSON.stringify(summary, null, 2));
console.log(`\nFINAL: ${summary.verdict}`);
process.exit(0); // artifacts & log tell the story; don't fail the workflow
