/**
 * Real viewport-based image loading for TV browsers.
 *
 * Chromium 69 (Samsung Tizen 5.5) ignores the `loading="lazy"` attribute, so
 * a `<img loading="lazy">` poster still fires its network request the moment
 * React inserts it. A home page with hundreds of cards therefore queues
 * hundreds of image downloads during the first seconds on a TV whose CPU and
 * network stack are the slowest in the fleet. Desktop browsers lazy-load
 * natively, so everything in here is armed on the TV only; the desktop render
 * path never calls into this module.
 *
 * Strategy:
 * 1. A *native* IntersectionObserver (Chromium 51+, so present on Tizen 5.5)
 *    arms one observer per image with a generous rootMargin and disconnects
 *    after the first intersection.
 * 2. Where no native observer exists, a shared scroll/resize/focus ticker
 *    batches `getBoundingClientRect()` checks into one layout read per
 *    animation frame — never a per-image scroll listener, which old TV
 *    engines handle very badly.
 *
 * The boot shim in src/lib/tvBoot.ts deliberately fires "intersecting" for
 * every element immediately (it exists so libraries do not crash, not to
 * prioritize loading), so it is marked and excluded from step 1 — with the
 * shim in place we fall through to step 2 instead of loading everything.
 */

import { isTvBrowser } from "./browser";

/** Extra room around the viewport that still counts as "about to be visible". */
const DEFAULT_MARGIN_PX = 240;

interface MinimalObserver {
  observe(el: Element): void;
  disconnect(): void;
}

type MinimalObserverCallback = (entries: Array<{ isIntersecting?: boolean }>) => void;

type MinimalObserverConstructor = new (
  callback: MinimalObserverCallback,
  options?: { root?: Element | null; rootMargin?: string; threshold?: number | number[] },
) => MinimalObserver;

/**
 * The real IntersectionObserver constructor, or null when absent. The
 * `__tvBootShim` marker assigned by src/lib/tvBoot.ts identifies the fake.
 */
function nativeIntersectionObserver(): MinimalObserverConstructor | null {
  if (typeof window === "undefined") return null;
  const ctor = window.IntersectionObserver as
    (MinimalObserverConstructor & { __tvBootShim?: boolean }) | undefined;
  if (typeof ctor !== "function" || ctor.__tvBootShim === true) return null;
  return ctor;
}

/**
 * True when image visibility-gating should be active in this browser.
 * SSR renders (no window) and desktop browsers always skip the gating.
 */
export function shouldGateImageVisibility(): boolean {
  if (typeof window === "undefined") return false;
  return isTvBrowser();
}

interface PendingCheck {
  el: Element;
  margin: number;
  onVisible: () => void;
}

const pendingChecks: PendingCheck[] = [];
let ticking = false;
let listenersAttached = false;

function isRectInViewport(el: Element, margin: number): boolean {
  const rect = el.getBoundingClientRect();
  // A zero-size rect means the element is not laid out yet or is inside a
  // closed overlay. Loading it anyway keeps the manual path fail-open.
  if (rect.width <= 0 && rect.height <= 0) return true;
  const doc = document.documentElement;
  const vw = window.innerWidth || doc.clientWidth || 0;
  const vh = window.innerHeight || doc.clientHeight || 0;
  return (
    rect.bottom >= -margin &&
    rect.top <= vh + margin &&
    rect.right >= -margin &&
    rect.left <= vw + margin
  );
}

function flushPendingChecks() {
  ticking = false;
  for (let i = pendingChecks.length - 1; i >= 0; i--) {
    const item = pendingChecks[i];
    let visible = true;
    try {
      visible = isRectInViewport(item.el, item.margin);
    } catch (_) {
      visible = true;
    }
    if (!visible) continue;
    pendingChecks.splice(i, 1);
    if (pendingChecks.length === 0) detachViewportListeners();
    try {
      item.onVisible();
    } catch (_) {
      /* a throwing callback must not strand the remaining checks */
    }
  }
}

function scheduleViewportTick() {
  if (ticking || pendingChecks.length === 0) return;
  ticking = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(flushPendingChecks);
  } else {
    setTimeout(flushPendingChecks, 16);
  }
}

function onViewportEvent() {
  scheduleViewportTick();
}

function attachViewportListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  // Capture phase because scroll events do not bubble: the card rows are the
  // scrollable elements on the TV, not the window.
  window.addEventListener("scroll", onViewportEvent, true);
  window.addEventListener("resize", onViewportEvent);
  // D-pad focus expands cards and reflows rows without firing scroll.
  document.addEventListener("focusin", onViewportEvent);
}

function detachViewportListeners() {
  if (!listenersAttached) return;
  listenersAttached = false;
  window.removeEventListener("scroll", onViewportEvent, true);
  window.removeEventListener("resize", onViewportEvent);
  document.removeEventListener("focusin", onViewportEvent);
}

/**
 * Call `onVisible` exactly once, as soon as `element` is in (or about to
 * enter) the viewport. Returns an unsubscribe function; calling it after the
 * element became visible is a no-op. Everything is defensive: if any
 * observation strategy fails, the image is treated as visible so it still
 * loads.
 */
export function watchElementVisibility(
  element: Element,
  onVisible: () => void,
  marginPx: number = DEFAULT_MARGIN_PX,
): () => void {
  const observerCtor = nativeIntersectionObserver();
  if (observerCtor) {
    try {
      let settled = false;
      let observer: MinimalObserver | null = new observerCtor(
        (entries) => {
          for (let i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              settleAndNotify();
              return;
            }
          }
        },
        { root: null, rootMargin: `${marginPx}px`, threshold: 0 },
      );
      function settleAndNotify() {
        if (settled) return;
        settled = true;
        if (observer) {
          try {
            observer.disconnect();
          } catch (_) {
            /* already detached */
          }
          observer = null;
        }
        onVisible();
      }
      observer.observe(element);
      return () => {
        if (settled) return;
        settled = true;
        if (observer) {
          try {
            observer.disconnect();
          } catch (_) {
            /* ignore */
          }
          observer = null;
        }
      };
    } catch (_) {
      // Old/partial implementations (constructor or observe throwing) fall
      // through to the manual rect checks below.
    }
  }

  const item: PendingCheck = {
    el: element,
    margin: marginPx,
    onVisible: () => {
      const index = pendingChecks.indexOf(item);
      if (index >= 0) pendingChecks.splice(index, 1);
      if (pendingChecks.length === 0) detachViewportListeners();
      onVisible();
    },
  };
  pendingChecks.push(item);
  attachViewportListeners();
  // First pass on the next frame so a mount storm of dozens of cards
  // performs one batched layout read instead of dozens.
  scheduleViewportTick();
  return () => {
    const index = pendingChecks.indexOf(item);
    if (index >= 0) pendingChecks.splice(index, 1);
    if (pendingChecks.length === 0) detachViewportListeners();
  };
}
