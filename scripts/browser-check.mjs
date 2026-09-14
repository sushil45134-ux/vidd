/**
 * Local browser smoke test using @sparticuz/chromium (sandbox has no access
 * to the Playwright CDN). Loads the app, waits for data, and reports:
 * console errors, hero/row/card counts, Coming Soon count, modal open time.
 *
 * Usage: node scripts/browser-check.mjs [url] [--ss]   (--ss = simulate slow 3G-ish network)
 */
import { chromium } from "playwright";
import sparticuz from "@sparticuz/chromium";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) || "http://localhost:4173";
const slow = args.includes("--ss");

const exe = await sparticuz.executablePath();
const browser = await chromium.launch({
  executablePath: exe,
  args: [...sparticuz.args, "--no-sandbox", "--disable-setuid-sandbox"],
});

const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
});
if (slow) {
  // ~1.6 Mbps down, 750 kbps up, 300 ms RTT — roughly a weak 4G connection.
  await context.route("**/*", async (route) => {
    await new Promise((r) => setTimeout(r, 150));
    await route.continue();
  });
}
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));

const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
const dcl = Date.now() - t0;

// Wait for the hero to get a real title (data loaded) or 30s.
let dataMs = null;
try {
  await page.waitForFunction(
    () => {
      const h = document.querySelector("h1");
      return h && h.textContent.trim().length > 0 && !document.querySelector(".animate-pulse h1");
    },
    { timeout: 30000 },
  );
  dataMs = Date.now() - t0;
} catch {
  /* keep going — report what we have */
}
const dataStat = Date.now() - t0;

const counts = await page.evaluate(() => ({
  heroTitle: document.querySelector("h1")?.textContent?.trim()?.slice(0, 60) || "(none)",
  rows: document.querySelectorAll("h2").length,
  rowTitles: Array.from(document.querySelectorAll("h2"))
    .slice(0, 8)
    .map((h) => h.textContent.trim()),
  cards: document.querySelectorAll(".movie-card").length,
  comingSoon: Array.from(document.querySelectorAll("p, span")).filter((n) =>
    /coming soon/i.test(n.textContent || ""),
  ).length,
  images: document.images.length,
  imagesLoaded: Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 0).length,
  domNodes: document.querySelectorAll("*").length,
}));

// Modal open timing: click the first real movie card.
let modalMs = null;
try {
  const card = page.locator(".movie-card").first();
  if ((await card.count()) > 0) {
    const c0 = Date.now();
    await card.click({ timeout: 5000 });
    await page.waitForSelector(
      ".fixed.inset-0 h2, .fixed.inset-0 h1, [class*='animate-fade-in'] h2",
      {
        timeout: 20000,
      },
    );
    modalMs = Date.now() - c0;
  }
} catch (e) {
  consoleErrors.push("modal test: " + String(e).slice(0, 150));
}

// Scroll test: page should scroll without freezing.
let scrollOk = false;
try {
  const s0 = Date.now();
  await page.evaluate(async () => {
    for (let y = 0; y < 3000; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  scrollOk = Date.now() - s0 < 4000;
} catch {
  /* ignore */
}

console.log(
  JSON.stringify(
    {
      url,
      slow,
      dcl,
      dataMs,
      dataStat,
      modalMs,
      scrollOk,
      counts,
      consoleErrors: consoleErrors.slice(0, 8),
      pageErrors: pageErrors.slice(0, 5),
    },
    null,
    2,
  ),
);
await browser.close();
