#!/usr/bin/env node
/**
 * Offline tests for the Nxsha Fullscreen Bot (src/lib/nxshaFullscreenBot.ts).
 * No network, no browser download — a hand-rolled DOM double good enough to
 * pin the behaviour that actually matters:
 *
 *   - the PROVIDER'S IFRAME goes fullscreen, not Vidd's wrapper
 *   - it happens on its own, with zero clicks on a fullscreen control
 *   - landscape is locked, which is the half a phone user really sees
 *   - a lost user activation is retried, including on the next gesture
 *   - taps on Vidd's own buttons are not hijacked
 *   - once the user leaves fullscreen the bot stands down for good
 *
 * Run: node --experimental-strip-types scripts/nxsha-fullscreen.test.mjs
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const botModule = resolve(here, "../src/lib/nxshaFullscreenBot.ts");

/* ------------------------------------------------------------------ *
 * Minimal DOM double
 * ------------------------------------------------------------------ */

class Emitter {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, ...event });
  }
  listenerCount() {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

/** Stand-in for an element the browser can put in the top layer. */
class FakeElement extends Emitter {
  constructor(env, { tag = "div", control = false } = {}) {
    super();
    this.env = env;
    this.tag = tag;
    this.control = control;
    this.fullscreenRequests = 0;
    this.requestFullscreen = () => {
      this.fullscreenRequests += 1;
      if (!env.navigator.userActivation.isActive) {
        return Promise.reject(new Error("no transient activation"));
      }
      env.enterFullscreen(this);
      return Promise.resolve();
    };
  }
  /** Only used by the bot's "is this one of Vidd's own controls?" guard. */
  closest(selector) {
    return this.control && selector.includes("button") ? this : null;
  }
}

class FakeIframe extends FakeElement {
  constructor(env) {
    super(env, { tag: "iframe" });
    this.messages = [];
    this.contentWindow = {
      postMessage: (message) => this.messages.push(message),
    };
  }
}

function makeEnv({ popoverSupported = true, activation = true } = {}) {
  const env = {};

  env.window = new Emitter();
  env.window.setTimeout = (fn, ms) => setTimeout(fn, ms);
  env.window.clearTimeout = (id) => clearTimeout(id);

  env.document = new Emitter();
  env.document.fullscreenElement = null;
  env.document.exitFullscreen = () => {
    env.leaveFullscreen();
    return Promise.resolve();
  };

  env.navigator = { userActivation: { isActive: activation } };

  env.orientation = { locked: null, unlocks: 0 };
  env.screen = {
    orientation: {
      lock: (value) => {
        env.orientation.locked = value;
        return Promise.resolve();
      },
      unlock: () => {
        env.orientation.locked = null;
        env.orientation.unlocks += 1;
      },
    },
  };

  env.enterFullscreen = (element) => {
    env.document.fullscreenElement = element;
    env.document.dispatch("fullscreenchange");
  };
  env.leaveFullscreen = () => {
    env.document.fullscreenElement = null;
    env.document.dispatch("fullscreenchange");
  };

  env.HTMLElement = class {};
  if (popoverSupported) env.HTMLElement.prototype.showPopover = function showPopover() {};

  env.iframe = new FakeIframe(env);
  env.container = new FakeElement(env);
  return env;
}

/** Swap the globals the bot reads, run a scenario, then put them back. */
async function withEnv(env, fn) {
  const saved = {};
  const keys = ["window", "document", "navigator", "screen", "HTMLElement"];
  for (const key of keys) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value: env[key],
      configurable: true,
      writable: true,
    });
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  }
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(async () => {
    try {
      await fn();
      passed += 1;
      console.log(`✅ ${name}`);
    } catch (error) {
      console.error(`❌ ${name}: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

/* ------------------------------------------------------------------ *
 * URL hints — pure, no DOM needed
 * ------------------------------------------------------------------ */

const { withNxshaFullscreenHints, isNxshaUrl, startNxshaFullscreenBot } = await import(botModule);

test("nxsha urls are recognised, others are not", () => {
  assert.equal(isNxshaUrl("https://nxsha.space/embed/tv/1399/1/1"), true);
  assert.equal(isNxshaUrl("https://web.nxsha.app/embed/tv/1399/1/1"), true);
  assert.equal(isNxshaUrl("https://www.dailymotion.com/embed/video/x9abc"), false);
});

test("hints are added without disturbing the provider template's params", () => {
  const out = new URL(
    withNxshaFullscreenHints(
      "https://nxsha.space/embed/tv/1399/1/1?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true",
    ),
  );
  assert.equal(out.searchParams.get("lang"), "hi");
  assert.equal(out.searchParams.get("server"), "GbruHindi");
  assert.equal(out.searchParams.get("one_server"), "true");
  assert.equal(out.searchParams.get("disable_app_ad"), "true");
  assert.equal(out.searchParams.get("autoplay"), "true");
  assert.equal(out.searchParams.get("fullscreen"), "true");
});

test("an explicit param the caller set is never overwritten", () => {
  const out = new URL(
    withNxshaFullscreenHints("https://nxsha.space/embed/tv/1/1/1?autoplay=false"),
  );
  assert.equal(out.searchParams.get("autoplay"), "false");
});

test("non-nxsha embeds are returned untouched", () => {
  const url = "https://player.vimeo.com/video/59777392?h=ab882a04fd";
  assert.equal(withNxshaFullscreenHints(url), url);
});

/* ------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------ */

test("the embed iframe — not Vidd's wrapper — ends up fullscreen, with no clicks", async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const statuses = [];
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
      onStatus: (status) => statuses.push(status),
    });
    await tick();
    assert.equal(env.document.fullscreenElement, env.iframe, "iframe should own the screen");
    assert.equal(env.container.fullscreenRequests, 0, "wrapper must not be fullscreened");
    assert.ok(statuses.includes("on"), `expected an "on" status, saw ${statuses.join(",")}`);
    stop();
  });
});

test("landscape is locked on success and released on stop", async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
    });
    await tick();
    assert.equal(env.orientation.locked, "landscape");
    stop();
    assert.equal(env.orientation.locked, null);
    assert.ok(env.orientation.unlocks >= 1);
  });
});

test("rotate:false leaves the orientation alone", async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
      rotate: false,
    });
    await tick();
    assert.equal(env.document.fullscreenElement, env.iframe);
    assert.equal(env.orientation.locked, null);
    stop();
  });
});

test("without top-layer popovers it falls back to the wrapper, so Close stays reachable", async () => {
  const env = makeEnv({ popoverSupported: false });
  await withEnv(env, async () => {
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
    });
    await tick();
    assert.equal(env.document.fullscreenElement, env.container);
    assert.equal(env.iframe.fullscreenRequests, 0);
    stop();
  });
});

test("no user activation: nothing is requested, then the next gesture lands it", async () => {
  const env = makeEnv({ activation: false });
  await withEnv(env, async () => {
    const statuses = [];
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
      onStatus: (status) => statuses.push(status),
    });
    await tick(60);
    assert.equal(env.iframe.fullscreenRequests, 0, "must not spam a request it cannot win");
    assert.equal(statuses.at(-1), "waiting");

    // The user taps somewhere in Vidd (not a control) — activation is back.
    env.navigator.userActivation.isActive = true;
    env.window.dispatch("pointerdown", { target: new FakeElement(env) });
    await tick();
    assert.equal(env.document.fullscreenElement, env.iframe);
    stop();
  });
});

/**
 * One scenario, because both facts only hold once the timed retry ladder has
 * run itself out (~5s): after that the bot is idle-but-armed, so what happens
 * next is purely the gesture path.
 */
test("nudges stay capped, and only a real (non-control) gesture lands it", async () => {
  const env = makeEnv({ activation: false });
  await withEnv(env, async () => {
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
    });
    await tick(5300); // outlast RETRY_SCHEDULE_MS

    assert.ok(env.iframe.messages.length > 0, "expected postMessage nudges");
    assert.ok(
      env.iframe.messages.length <= 60,
      `nudges must be burst-capped, saw ${env.iframe.messages.length}`,
    );
    assert.equal(env.iframe.fullscreenRequests, 0, "must not spam a request it cannot win");

    // A tap on Vidd's Close / Prev / Next is steering, not consent.
    env.navigator.userActivation.isActive = true;
    env.window.dispatch("pointerdown", {
      target: new FakeElement(env, { tag: "button", control: true }),
    });
    await tick();
    assert.equal(env.document.fullscreenElement, null, "Close/Prev/Next must not grab the screen");

    // Any other interaction carries the activation the bot was waiting for.
    env.window.dispatch("pointerdown", { target: new FakeElement(env) });
    await tick();
    assert.equal(env.document.fullscreenElement, env.iframe);
    stop();
  });
});

test("leaving fullscreen on purpose stands the bot down for good", async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const statuses = [];
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
      onStatus: (status) => statuses.push(status),
    });
    await tick();
    assert.equal(env.document.fullscreenElement, env.iframe);

    env.leaveFullscreen(); // Esc / Android back
    await tick();
    assert.equal(statuses.at(-1), "released");

    const before = env.iframe.fullscreenRequests;
    env.window.dispatch("pointerdown", { target: new FakeElement(env) });
    await tick(60);
    assert.equal(env.iframe.fullscreenRequests, before, "must not fight the user back in");
    assert.equal(env.document.fullscreenElement, null);
    stop();
  });
});

test("stop() removes every listener it added", async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const stop = startNxshaFullscreenBot({
      getIframe: () => env.iframe,
      getFallback: () => env.container,
    });
    await tick();
    assert.ok(env.window.listenerCount() > 0);
    stop();
    assert.equal(env.window.listenerCount(), 0, "window listeners leaked");
    assert.equal(env.document.listenerCount(), 0, "document listeners leaked");
    assert.equal(env.iframe.listenerCount(), 0, "iframe load listener leaked");
  });
});

test("a missing iframe never throws", async () => {
  const env = makeEnv();
  await withEnv(env, async () => {
    const stop = startNxshaFullscreenBot({
      getIframe: () => null,
      getFallback: () => null,
    });
    await tick();
    assert.equal(env.document.fullscreenElement, null);
    stop();
  });
});

for (const run of pending) await run();
console.log(`\n${passed}/${pending.length} passed`);
