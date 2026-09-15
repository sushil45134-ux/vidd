import { useEffect, useLayoutEffect, useState } from "react";
import { isTvBrowser, isTvLayoutActive } from "../lib/browser";

/**
 * `useLayoutEffect` logs a warning when a component renders on the server.
 * This file is imported by components that are server-rendered (TanStack
 * Start SSR), so fall back to `useEffect` where there is no window.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * SSR-safe "is this a TV browser?" flag.
 *
 * WHY THIS EXISTS
 * ---------------
 * `isTvBrowser()` reads `navigator.userAgent`, so it returns **false** while
 * the page is rendered on the server (no `navigator`) and **true** once the
 * same code runs inside a Tizen/webOS TV. Reading it at module scope —
 * `const IS_TV = isTvBrowser()` — froze the answer at import time, so the
 * server emitted the desktop tree and the TV client expected the TV tree.
 * React then bailed out of hydration with error #418 and threw away the
 * server HTML.
 *
 * HOW IT FIXES IT
 * ---------------
 * The first render (server *and* the matching client hydration render) always
 * returns `false`, so both trees agree and hydration succeeds. The real value
 * is read afterwards, in a layout effect, which React flushes synchronously
 * before the browser paints — so a TV is corrected to `true` without ever
 * showing a frame of desktop layout.
 *
 * Use this in render output. Inside event handlers and other client-only code
 * (`onKeyDown`, `initSpatialNavigation`, …) calling `isTvBrowser()` directly
 * is still correct and cheaper.
 */
export function useIsTvBrowser(): boolean {
  const [isTv, setIsTv] = useState(false);

  useIsomorphicLayoutEffect(() => {
    // UA match first; the `tv-layout` class is a second chance for sets whose
    // UA the regex misses but which the boot script (src/lib/tvBoot.ts) still
    // detected before hydration. Both are client-only, so reading them here
    // can never desync the hydration render.
    const next = isTvBrowser() || isTvLayoutActive();
    setIsTv((prev) => (prev === next ? prev : next));
  }, []);

  return isTv;
}

export default useIsTvBrowser;
