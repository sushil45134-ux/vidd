/**
 * D-pad (spatial) navigation for TV browsers (Samsung Tizen 5.5, LG webOS…).
 *
 * - Arrow keys move DOM focus to the geometrically nearest focusable
 *   element in that direction (no external dependency).
 * - The remote's BACK key (Tizen keyCode 10009, Panasonic 461, or
 *   GoBack/BrowserBack key names) pops a LIFO stack of overlay close
 *   handlers: player → details modal → panels → page. With an empty stack
 *   the key is left untouched so the browser can exit the app naturally,
 *   and we replay a synthetic "Escape" keydown for components that only
 *   listen for Escape.
 *
 * Only active when the `tv-layout` class is on <html>, i.e. never on
 * desktop Chrome or phones.
 */

type BackHandler = () => void;

const backStack: BackHandler[] = [];

/** Register an overlay's close action. Returns an unregister function. */
export function registerTvBackHandler(handler: BackHandler): () => void {
  backStack.push(handler);
  return () => {
    const i = backStack.indexOf(handler);
    if (i >= 0) backStack.splice(i, 1);
  };
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

interface Box {
  el: HTMLElement;
  cx: number;
  cy: number;
}

function center(el: HTMLElement): Box | null {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

function focusableElements(): HTMLElement[] {
  const nodes = document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const out: HTMLElement[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    // Off-screen / display:none elements have empty client rects.
    if (el.getClientRects().length === 0) continue;
    // Skip elements hidden from assistive tech (closed panels etc.).
    if (el.closest('[aria-hidden="true"]')) continue;
    out.push(el);
  }
  return out;
}

/**
 * Pick the best candidate in `direction` relative to the currently focused
 * element: primary-axis distance plus a cross-axis penalty, so arrows feel
 * like a proper TV D-pad instead of a raw geometry sort.
 */
function pickCandidate(
  current: Box,
  candidates: Box[],
  direction: "up" | "down" | "left" | "right",
): HTMLElement | null {
  const CROSS_PENALTY = 2.2;
  const EPSILON = 6;
  let best: Box | null = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    const dx = cand.cx - current.cx;
    const dy = cand.cy - current.cy;
    let primary: number;
    let cross: number;

    if (direction === "left") {
      if (dx >= -EPSILON) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else if (direction === "right") {
      if (dx <= EPSILON) continue;
      primary = dx;
      cross = Math.abs(dy);
    } else if (direction === "up") {
      if (dy >= -EPSILON) continue;
      primary = -dy;
      cross = Math.abs(dx);
    } else {
      if (dy <= EPSILON) continue;
      primary = dy;
      cross = Math.abs(dx);
    }

    const score = primary + CROSS_PENALTY * cross;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best ? best.el : null;
}

function moveFocus(direction: "up" | "down" | "left" | "right"): boolean {
  const active = document.activeElement;
  const items = focusableElements();
  if (items.length === 0) return false;

  if (!(active instanceof HTMLElement) || active === document.body) {
    items[0].focus();
    return true;
  }

  const from = center(active);
  if (!from) return false;

  const next = pickCandidate(
    from,
    items.map((el) => center(el)).filter((b): b is Box => b !== null),
    direction,
  );
  if (!next || next === active) return false;

  try {
    next.focus({ preventScroll: true });
  } catch (_) {
    next.focus();
  }
  try {
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch (_) {
    /* older engines without options — focus() already scrolled */
  }
  return true;
}

function isTvLayoutOn(): boolean {
  return (
    typeof document !== "undefined" && document.documentElement.classList.contains("tv-layout")
  );
}

/**
 * Attach the global keydown listener. Returns a cleanup function.
 * A no-op on non-TV browsers.
 */
export function initSpatialNavigation(): () => void {
  if (typeof window === "undefined") return () => {};
  if (
    !/SMART-TV|SMARTTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Viera|HbbTV|GoogleTV|Android TV|TV Safari/i.test(
      navigator.userAgent,
    )
  ) {
    return () => {};
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isTvLayoutOn()) return;

    // ── Remote BACK ────────────────────────────────────────────────────
    if (e.keyCode === 10009 || e.keyCode === 461 || e.key === "GoBack" || e.key === "BrowserBack") {
      const top = backStack[backStack.length - 1];
      if (top) {
        e.preventDefault();
        e.stopPropagation();
        top();
        return;
      }
      // No overlay open: replay Escape for plain Escape-listeners, but let
      // the browser keep its default (exiting the app on a second press).
      try {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      } catch (_) {}
      return;
    }

    // ── D-pad arrows ───────────────────────────────────────────────────
    const key = e.key;
    const direction =
      key === "ArrowUp"
        ? "up"
        : key === "ArrowDown"
          ? "down"
          : key === "ArrowLeft"
            ? "left"
            : key === "ArrowRight"
              ? "right"
              : null;
    if (!direction) return;

    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      // Text caret: don't steal horizontal arrows from inputs.
      const inText =
        active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable;
      if (inText && (direction === "left" || direction === "right")) return;
      // Inside the player the YouTube embed owns the D-pad.
      if (active.tagName === "IFRAME") return;
      // The custom player controls handle arrows themselves.
      if (document.body.hasAttribute("data-tv-player-open")) return;
    }

    if (moveFocus(direction)) {
      e.preventDefault();
    }
  };

  // Capture phase so we run before React handlers and default scrolling.
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
