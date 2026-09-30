/**
 * Nxsha Fullscreen Bot
 * ====================
 * Episode khulte hi Nxsha ka player khud-ba-khud poore screen par —
 * user ko ek bhi click nahi karna padta.
 *
 * THE PROBLEM
 * -----------
 * The old auto-fullscreen call put **Vidd's own wrapper `<div>`** into
 * fullscreen. The screen went black-edge-to-edge, but the thing filling it
 * was Vidd's chrome with the Nxsha embed painted inside it — the provider's
 * player never entered *its* fullscreen mode. On a phone that is very
 * visible: the page is "fullscreen" but still portrait, so a 16:9 episode
 * stays a small strip in the middle. Users have to hunt for the little
 * expand icon inside the Nxsha player to get the real thing.
 *
 * WHAT THE BOT DOES
 * -----------------
 * Nxsha is a cross-origin iframe, so we can never reach in and click its
 * button. Instead the bot drives every lever the browser *does* give a
 * parent page, in one automatic burst, the moment an episode opens:
 *
 *   1. FULLSCREEN THE IFRAME ITSELF — not Vidd's wrapper. The Nxsha
 *      document becomes the fullscreen element, so its viewport *is* the
 *      screen and none of Vidd's UI is layered on top of it.
 *   2. LOCK LANDSCAPE — the half of "player fullscreen" people actually
 *      notice on a phone. Native players rotate; a plain `requestFullscreen`
 *      does not. Silently ignored on desktop.
 *   3. POSTMESSAGE NUDGE — a small battery of the fullscreen commands
 *      common embed players listen for, in case Nxsha exposes one. Unknown
 *      messages are ignored by the receiver, so this is free.
 *   4. URL HINTS — autoplay/fullscreen query flags alongside the existing
 *      `disable_app_ad`, for the same best-effort reason.
 *
 * WHY IT KEEPS RETRYING
 * ---------------------
 * `requestFullscreen()` needs transient user activation. The Play tap
 * normally still counts when the player mounts, but a slow route change,
 * an iframe that loads late, or a browser that spends the activation
 * elsewhere can lose it. So the bot re-checks `navigator.userActivation`
 * (no activation → don't even call, that only spams the console), retries
 * on a short backoff, retries again when the iframe fires `load`, and arms
 * a one-shot listener so the very next touch anywhere lands it. The user
 * still never clicks a fullscreen button.
 *
 * WHY IT STOPS
 * ------------
 * The moment someone leaves fullscreen on purpose (Esc, Android back, the
 * system gesture) the bot stands down for good. An auto-fullscreen that
 * fights the user is worse than no auto-fullscreen at all.
 */

/* ------------------------------------------------------------------ *
 * Vendor-prefixed fullscreen surface (old WebKit, Tizen 5.x, webOS)
 * ------------------------------------------------------------------ */

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

type OrientationLocker = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

/** Current fullscreen element across every prefix a TV browser might use. */
export function currentFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FullscreenDocument;
  return (
    d.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.webkitCurrentFullScreenElement ??
    d.mozFullScreenElement ??
    d.msFullscreenElement ??
    null
  );
}

/** Request fullscreen on one element. Never throws; resolves to success. */
export async function requestFullscreenOn(element: HTMLElement | null): Promise<boolean> {
  if (!element) return false;
  const el = element as FullscreenElement;
  const request =
    el.requestFullscreen ??
    el.webkitRequestFullscreen ??
    el.webkitRequestFullScreen ??
    el.mozRequestFullScreen ??
    el.msRequestFullscreen;
  if (!request) return false;
  try {
    await request.call(el);
  } catch {
    // Blocked by policy or a spent activation — the caller just retries.
  }
  return currentFullscreenElement() === element;
}

/** Leave fullscreen across every prefix. Never throws. */
export function exitFullscreen(): void {
  if (typeof document === "undefined") return;
  const d = document as FullscreenDocument;
  const exit =
    d.exitFullscreen ?? d.webkitExitFullscreen ?? d.mozCancelFullScreen ?? d.msExitFullscreen;
  if (!exit) return;
  try {
    const result = exit.call(d);
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // Already out of fullscreen.
  }
}

/**
 * True when the page still holds transient user activation, i.e. a
 * `requestFullscreen()` right now has a chance. Browsers without the API
 * (Tizen, old WebKit) report `true` so they keep the old try-and-see path.
 */
export function hasUserActivation(): boolean {
  if (typeof navigator === "undefined") return false;
  const activation = (navigator as Navigator & { userActivation?: { isActive?: boolean } })
    .userActivation;
  if (!activation || typeof activation.isActive !== "boolean") return true;
  return activation.isActive;
}

/**
 * Popovers live in the top layer, which paints *above* the fullscreen
 * element — that is how Vidd can keep a working Close button while the
 * Nxsha iframe (and not Vidd's wrapper) owns the screen. Without it we
 * would be handing the user a fullscreen they cannot get out of by tapping,
 * so the bot falls back to the wrapper instead.
 */
export function supportsTopLayerPopover(): boolean {
  if (typeof HTMLElement === "undefined") return false;
  return typeof HTMLElement.prototype.showPopover === "function";
}

/* ------------------------------------------------------------------ *
 * Nxsha URL helpers
 * ------------------------------------------------------------------ */

/** nxsha.space / web.nxsha.app and friends. */
export function isNxshaUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes("nxsha");
  } catch {
    return /nxsha/i.test(url);
  }
}

/**
 * Best-effort query hints. Unknown params are ignored by the embed, and the
 * existing ones (`lang`, `server`, `one_server`, `disable_app_ad`) are left
 * exactly as the provider template wrote them.
 */
export function withNxshaFullscreenHints(url: string): string {
  if (!isNxshaUrl(url)) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("disable_app_ad")) u.searchParams.set("disable_app_ad", "true");
    if (!u.searchParams.has("autoplay")) u.searchParams.set("autoplay", "true");
    if (!u.searchParams.has("fullscreen")) u.searchParams.set("fullscreen", "true");
    return u.toString();
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ *
 * postMessage nudge
 * ------------------------------------------------------------------ */

/**
 * "Go fullscreen" in the dialects common embed players speak. We cannot
 * know which one (if any) Nxsha implements, and a cross-origin page cannot
 * be inspected, so the bot says all of them and lets the receiver ignore
 * what it does not understand.
 */
const FULLSCREEN_NUDGES: unknown[] = [
  "fullscreen",
  "requestFullscreen",
  "enterFullscreen",
  { event: "command", func: "requestFullscreen", args: [] },
  { type: "fullscreen", value: true },
  { type: "player", action: "fullscreen", value: true },
  { action: "fullscreen", value: true },
  { method: "setFullscreen", args: [true] },
  { command: "fullscreen", args: [true] },
];

/** Fire the nudge battery at an embed. Cheap, silent, safe to repeat. */
export function postFullscreenNudge(iframe: HTMLIFrameElement | null): void {
  const target = iframe?.contentWindow;
  if (!target) return;
  for (const message of FULLSCREEN_NUDGES) {
    try {
      target.postMessage(message, "*");
      if (typeof message !== "string") target.postMessage(JSON.stringify(message), "*");
    } catch {
      // Cross-origin postMessage never throws in practice; stay defensive.
    }
  }
}

/* ------------------------------------------------------------------ *
 * Orientation
 * ------------------------------------------------------------------ */

function orientationApi(): OrientationLocker | null {
  if (typeof screen === "undefined") return null;
  const orientation = (screen as Screen & { orientation?: OrientationLocker }).orientation;
  return orientation ?? null;
}

/**
 * The part of "player fullscreen" a phone user actually sees. Only attempted
 * while fullscreen (browsers reject it otherwise) and always best-effort:
 * desktop rejects with NotSupportedError, which is fine.
 */
export function lockLandscape(): void {
  const orientation = orientationApi();
  if (!orientation?.lock) return;
  try {
    orientation.lock("landscape")?.catch(() => {});
  } catch {
    // Desktop / unsupported — no rotation, everything else still applies.
  }
}

/** Give the screen back to the OS when the player closes. */
export function releaseOrientation(): void {
  const orientation = orientationApi();
  if (!orientation?.unlock) return;
  try {
    orientation.unlock();
  } catch {
    // Nothing was locked.
  }
}

/* ------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------ */

export type NxshaFullscreenStatus =
  /** Nothing to do (disabled, or no element yet). */
  | "idle"
  /** Actively trying to grab the screen. */
  | "trying"
  /** No user activation left — armed, the next touch anywhere lands it. */
  | "waiting"
  /** We own the screen; the Nxsha embed is the fullscreen element. */
  | "on"
  /** The user left fullscreen on purpose. The bot will not fight back. */
  | "released";

export interface NxshaFullscreenBotOptions {
  /** The cross-origin embed we want on screen. */
  getIframe: () => HTMLIFrameElement | null;
  /**
   * Used instead of the iframe when Vidd's own controls could not survive
   * in the top layer — a fullscreen with no way out is not worth it.
   */
  getFallback: () => HTMLElement | null;
  /** Skip everything (direct video files, Dailymotion SDK, …). */
  enabled?: boolean;
  /** Rotate to landscape once fullscreen lands. Default: true. */
  rotate?: boolean;
  /** Status changes, for rendering the top-layer Close button. */
  onStatus?: (status: NxshaFullscreenStatus, target: HTMLElement | null) => void;
}

/**
 * Retry schedule (ms after mount) for when the first, synchronous attempt
 * did not land. Short, then the bot gives up quietly.
 */
const RETRY_SCHEDULE_MS = [80, 250, 600, 1200, 2200, 3500, 5000];

/** Gestures that hand the page a fresh activation to spend. */
const GESTURES = ["pointerdown", "touchstart", "touchend", "mousedown", "keydown", "click"];

/** How long the gesture fallback stays armed before the bot goes quiet. */
const GESTURE_WINDOW_MS = 30_000;

/** Nudge bursts are free but not silent — a handful is plenty. */
const MAX_NUDGE_BURSTS = 4;

/**
 * A tap on Close / Prev / Next is the user steering Vidd, not a licence to
 * grab the screen. Grabbing fullscreen on the same tap that closes the
 * player makes it flash; skip anything that looks like one of our controls.
 */
function isOwnControl(eventTarget: EventTarget | null): boolean {
  const node = eventTarget as Element | null;
  if (!node || typeof node.closest !== "function") return false;
  return !!node.closest('button, a, input, select, textarea, [role="button"]');
}

/**
 * Start the bot. Returns a stop function — call it on unmount.
 *
 * Usage lives in `EmbedPlayer`; keeping the logic here means the retry
 * ladder, the activation rules and the stand-down behaviour are testable
 * and documented in one place instead of smeared across a component.
 */
export function startNxshaFullscreenBot(options: NxshaFullscreenBotOptions): () => void {
  const { getIframe, getFallback, enabled = true, rotate = true, onStatus } = options;

  if (typeof window === "undefined" || typeof document === "undefined" || !enabled) {
    return () => {};
  }

  let stopped = false;
  /** Set once the user leaves fullscreen deliberately — we never re-enter. */
  let standDown = false;
  let landed = false;
  let status: NxshaFullscreenStatus = "idle";
  let target: HTMLElement | null = null;
  let nudgeBursts = 0;
  const startedAt = Date.now();
  const timers: number[] = [];

  const nudge = () => {
    if (nudgeBursts >= MAX_NUDGE_BURSTS) return;
    nudgeBursts += 1;
    postFullscreenNudge(getIframe());
  };

  const setStatus = (next: NxshaFullscreenStatus) => {
    if (status === next) return;
    status = next;
    try {
      onStatus?.(next, target);
    } catch {
      // A status listener must never break playback.
    }
  };

  /**
   * The iframe itself is the goal — that is the difference between "Vidd is
   * fullscreen" and "Nxsha is fullscreen". We only step back to Vidd's
   * wrapper when the browser cannot paint our Close button above a
   * fullscreen iframe.
   */
  const pickTarget = (): HTMLElement | null => {
    const iframe = getIframe();
    if (iframe && supportsTopLayerPopover()) return iframe;
    return getFallback() ?? iframe;
  };

  const settle = (element?: HTMLElement | null) => {
    if (element) target = element;
    landed = true;
    setStatus("on");
    if (rotate) lockLandscape();
  };

  const attempt = async () => {
    if (stopped || standDown || landed) return;

    target = pickTarget();
    if (!target) return;

    // Free levers first: they might do the job without a fullscreen grant.
    nudge();

    if (currentFullscreenElement() === target) {
      settle();
      return;
    }

    // Calling without activation only logs a console warning and fails, so
    // wait for a gesture instead of burning attempts.
    if (!hasUserActivation()) {
      setStatus("waiting");
      return;
    }

    setStatus("trying");
    const ok = await requestFullscreenOn(target);
    if (stopped) return;
    if (ok) settle();
    else setStatus("waiting");
  };

  const runAttempt = () => {
    void attempt();
  };

  // 1. Right now, synchronously. `attempt()` reaches `requestFullscreen()`
  //    before its first await, so the Play tap that mounted the player is
  //    still spendable — this is the path that makes it feel instant.
  runAttempt();

  // 2. A short backoff behind it, for a slow route change or an iframe that
  //    is still attaching.
  for (const delay of RETRY_SCHEDULE_MS) {
    timers.push(window.setTimeout(runAttempt, delay));
  }

  // 3. The embed finishing its load is the best moment for the nudges.
  const iframeAtStart = getIframe();
  const onIframeLoad = () => {
    nudge();
    runAttempt();
  };
  iframeAtStart?.addEventListener("load", onIframeLoad);

  // 4. Last resort: the next interaction anywhere in Vidd carries a fresh
  //    activation. Still zero *deliberate* fullscreen clicks — the user
  //    never has to find a fullscreen button, they just keep using the app.
  const onGesture = (event: Event) => {
    if (stopped || standDown || landed) return;
    if (Date.now() - startedAt > GESTURE_WINDOW_MS) return;
    if (isOwnControl(event.target)) return;
    runAttempt();
  };
  for (const type of GESTURES) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }

  // 5. Track reality: React state and the browser must not drift apart, and
  //    a deliberate exit permanently stops the bot.
  const onFullscreenChange = () => {
    if (stopped) return;
    const element = currentFullscreenElement();
    if (element && (element === target || element === getIframe() || element === getFallback())) {
      settle(element as HTMLElement);
      return;
    }
    if (!element && landed) {
      standDown = true;
      landed = false;
      releaseOrientation();
      setStatus("released");
    }
  };
  for (const type of [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange",
  ]) {
    document.addEventListener(type, onFullscreenChange);
  }

  return () => {
    stopped = true;
    for (const timer of timers) window.clearTimeout(timer);
    iframeAtStart?.removeEventListener("load", onIframeLoad);
    for (const type of GESTURES) {
      window.removeEventListener(type, onGesture, { capture: true } as EventListenerOptions);
    }
    for (const type of [
      "fullscreenchange",
      "webkitfullscreenchange",
      "mozfullscreenchange",
      "MSFullscreenChange",
    ]) {
      document.removeEventListener(type, onFullscreenChange);
    }
    releaseOrientation();
  };
}

export default startNxshaFullscreenBot;
