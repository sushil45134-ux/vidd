/**
 * Real React + browser smoke test with a deterministic, offline YouTube API.
 * Optional test tools (not production dependencies / no lockfile changes):
 * npm install --no-save --package-lock=false --legacy-peer-deps playwright
 * npx playwright install chromium
 * node scripts/smoke-tv-player.mjs
 * Alternatively install @sparticuz/chromium too, and set SMOKE_PACKAGED_CHROMIUM=1.
 * This tests host controls/failure handling, not actual Tizen video decoding.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const fixture = await mkdtemp(resolve(root, ".tv-player-smoke-"));
let server;
let browser;
try {
  // Run identical desktop interactions against the pre-task implementation.
  const baseline = execFileSync(
    "git",
    ["show", "38fe48a4a434fe82907671f99691646c4a81b758:src/components/VideoPlayer.tsx"],
    { cwd: root, encoding: "utf8" },
  ).replaceAll('"../lib/', '"/src/lib/');
  await writeFile(resolve(fixture, "Baseline.tsx"), baseline);
  await writeFile(
    resolve(fixture, "index.html"),
    '<html><head></head><body><button id="outside">Catalogue</button><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(fixture, "entry.tsx"),
    `import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { VideoPlayer } from "/src/components/VideoPlayer";
import { VideoPlayer as Baseline } from "./Baseline";
import { initSpatialNavigation } from "/src/lib/spatialNav";
import { isTvBrowser } from "/src/lib/browser";
import "/src/styles.css";
if (isTvBrowser()) document.documentElement.classList.add("tv-layout");
initSpatialNavigation();
const params = new URLSearchParams(location.search);
const Component = params.has("baseline") ? Baseline : VideoPlayer;
window.emitState = (state) => flushSync(() => window.api.emit(state));
window.smokeRoot = createRoot(document.getElementById("root"));
window.smokeRoot.render(<Component videoId="smoke-video" autoPlay={!params.has("paused")} onClose={() => { window.closedByPlayer = true; }} />);`,
  );
  server = await createServer({
    root,
    configFile: false,
    plugins: [react(), tailwindcss()],
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "lucide-react"] },
    server: { host: "0.0.0.0", port: 0, allowedHosts: true },
  });
  await server.listen();
  const launchOptions = { headless: true };
  if (process.env.SMOKE_PACKAGED_CHROMIUM) {
    const { default: packaged } = await import("@sparticuz/chromium");
    launchOptions.executablePath = await packaged.executablePath();
    launchOptions.args = packaged.args.filter(
      (arg) => arg !== "--single-process" && arg !== "--disable-web-security",
    );
  }
  browser = await chromium.launch(launchOptions);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/${fixture.split("/").pop()}/index.html`;
  const tvUA =
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 Chrome/69.0.3497.106 TV Safari/537.36";
  const errors = [];
  async function open({ tv = true, mode = "ready", paused = false, baseline = false } = {}) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      ...(tv ? { userAgent: tvUA } : {}),
    });
    page.on("pageerror", (error) => errors.push(error.message));
    // No actual YouTube calls or stream extraction. Script failure is explicit;
    // all other scenarios use a loaded-but-silent API script and mock iframe.
    await page.route(/https:\/\//, (route) =>
      mode === "script-error" && route.request().url().includes("iframe_api")
        ? route.abort()
        : route.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.addInitScript(
      ({ mode }) => {
        window.calls = [];
        if (mode === "missing" || mode === "script-error") return;
        window.YT = {
          PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3, UNSTARTED: -1, ENDED: 0 },
          Player: class {
            constructor(node, options) {
              if (mode === "throws") throw new Error("Mock constructor failure");
              this.options = options;
              this.time = 30;
              this.state = -1;
              this.iframe = document.createElement("iframe");
              this.iframe.src =
                "https://www.youtube.com/embed/mock?" + new URLSearchParams(options.playerVars);
              node.replaceWith(this.iframe);
              window.api = this;
            }
            ready() {
              this.options.events.onReady({ target: this });
            }
            emit(data) {
              this.state = data;
              this.options.events.onStateChange({ target: this, data });
            }
            playVideo() {
              window.calls.push(["play"]);
            }
            pauseVideo() {
              window.calls.push(["pause"]);
            }
            setVolume(value) {
              window.calls.push(["volume", value]);
            }
            seekTo(value) {
              this.time = value;
              window.calls.push(["seek", value]);
            }
            mute() {
              window.calls.push(["mute"]);
            }
            unMute() {
              window.calls.push(["unmute"]);
            }
            getCurrentTime() {
              return this.time;
            }
            getDuration() {
              return 120;
            }
            getPlayerState() {
              return this.state;
            }
            getVideoData() {
              return { title: "Smoke video" };
            }
            unloadModule() {}
            setOption() {}
            getOption() {
              return [];
            }
            destroy() {
              window.calls.push(["destroy"]);
              this.iframe.remove();
            }
          },
        };
      },
      { mode },
    );
    await page.clock.install();
    await page.goto(`${url}?${paused ? "paused&" : ""}${baseline ? "baseline" : ""}`);
    await page.waitForSelector("#root button");
    if (!["missing", "script-error", "throws"].includes(mode)) {
      await page.waitForFunction(() => window.api);
      if (mode === "ready") await page.evaluate(() => window.api.ready());
    }
    return page;
  }
  async function fallback(page) {
    await page.waitForFunction(() => document.querySelector('iframe[src*="controls=1"]'));
    assert.equal(await page.locator(".animate-spin").count(), 0, "fallback must clear spinner");
    assert.equal(await page.locator('iframe[src*="controls=0"]').count(), 0);
    assert.equal(await page.locator("iframe").count(), 1, "old player must be removed");
    assert.equal(await page.getByRole("button", { name: "Close video" }).isVisible(), true);
  }

  // All emergency paths, including a constructed but never-ready player.
  for (const mode of ["missing", "script-error", "never-ready", "throws", "ready"]) {
    const page = await open({ mode });
    if (mode === "missing" || mode === "never-ready") await page.clock.runFor(10001);
    if (mode === "ready")
      await page.evaluate(() => window.api.options.events.onError({ data: 153 }));
    await fallback(page);
    if (mode === "never-ready" || mode === "ready") {
      await page.evaluate(() => {
        window.api.ready();
        window.emitState(3);
      });
      assert.equal(await page.locator(".animate-spin").count(), 0, "late events ignored");
      assert.ok((await page.evaluate(() => window.calls)).some(([call]) => call === "destroy"));
    }
    await page.clock.runFor(15001);
    await page.getByRole("button", { name: "Switch player" }).click();
    assert.match(await page.locator("iframe").getAttribute("src"), /youtube-nocookie.com/);
    await page.close();
    console.log(`PASS TV fallback: ${mode}`);
  }

  const page = await open({ paused: true });
  const vars = await page.evaluate(() => window.api.options.playerVars);
  for (const [key, value] of Object.entries({
    controls: 0,
    enablejsapi: 1,
    playsinline: 1,
    rel: 0,
    iv_load_policy: 3,
    fs: 0,
    autoplay: 0,
  }))
    assert.equal(vars[key], value, key);
  assert.equal(await page.locator(".animate-spin").count(), 0);
  assert.deepEqual(
    await page.evaluate(() => window.calls),
    [["volume", 80]],
    "autoPlay=false does not start playback",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
    "Play",
  );
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.emitState(1));
  await page.getByLabel("Pause", { exact: true }).waitFor();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
    "Seek backward 10 seconds",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const progress = page.getByLabel("Video progress");
  await progress.focus();
  const before = await progress.inputValue();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    Number(await progress.inputValue()),
    Number(before) + 1,
    "range arrows seek instead of moving focus",
  );
  await page.getByLabel("Volume", { exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByLabel("Mute", { exact: true }).click();
  const calls = await page.evaluate(() => window.calls);
  for (const expected of [
    ["play"],
    ["pause"],
    ["seek", 20],
    ["seek", 30],
    ["volume", 79],
    ["mute"],
  ])
    assert.ok(
      calls.some((call) => JSON.stringify(call) === JSON.stringify(expected)),
      JSON.stringify(expected),
    );
  await page.getByLabel("Fullscreen", { exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement);
  await page.getByLabel("Exit fullscreen").click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.clock.runFor(12000);
  assert.equal(
    await page.locator('iframe[src*="controls=1"]').count(),
    0,
    "ready cancels watchdog",
  );
  assert.equal(await page.getByLabel("Pause", { exact: true }).isVisible(), true);
  assert.equal(await page.locator("[data-tv-player-open]").count(), 0);
  assert.equal(await page.locator("iframe").getAttribute("tabindex"), "-1");
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "GoBack", keyCode: 10009 })),
  );
  assert.equal(await page.evaluate(() => window.closedByPlayer), true);
  await page.evaluate(() => window.emitState(3));
  await page.clock.runFor(15001);
  await fallback(page);
  await page.close();
  console.log(
    "PASS TV custom controls, D-pad, ranges, autoplay=false, fullscreen, BACK, buffering recovery",
  );

  async function desktopSnapshot(baseline, paused) {
    const page = await open({ tv: false, baseline, paused });
    const vars = await page.evaluate(() => window.api.options.playerVars);
    assert.equal(await page.locator("[data-tv-player-scope]").count(), 0);
    await page.keyboard.press("k");
    await page.evaluate(() => window.emitState(1));
    await page.keyboard.press("k");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("m");
    await page.mouse.move(300, 300);
    await page.clock.runFor(3100);
    const result = await page.evaluate(() => ({
      calls: window.calls,
      hasOnError: !!window.api.options.events.onError,
      crop: window.api.iframe.parentElement.parentElement.getAttribute("style"),
      controlsHidden: !!document.querySelector(".pointer-events-none.opacity-0"),
      shortcutsEnabled: document.body.hasAttribute("data-tv-player-open"),
    }));
    await page.close();
    return { vars, ...result };
  }
  for (const paused of [false, true]) {
    assert.deepEqual(await desktopSnapshot(false, paused), await desktopSnapshot(true, paused));
  }
  console.log(
    "PASS desktop identical to pre-task baseline: playerVars, autoplay on/off, shortcuts, crop, auto-hide",
  );
  assert.deepEqual(errors, [], "no uncaught browser errors");
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}
