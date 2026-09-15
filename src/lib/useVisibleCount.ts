import { useEffect, useState, useRef } from "react";
import { useIsTvBrowser } from "../hooks/useIsTvBrowser";

/**
 * Cap long grids/lists: render `initial` items, reveal `step` more per tap.
 * Resets automatically when `resetKey` changes (new tab, new search, …).
 * Render-phase reset (with previous-key guard) keeps it effect-free.
 *
 * TV optimization: Tizen 5.5 has the weakest CPU in the fleet — render half
 * as many cards initially so first paint is ~2x faster and the D-pad stays
 * responsive. Desktop keeps the original 48.
 */
export function useVisibleCount(
  resetKey: string,
  initial = 48,
  step = 48,
): { visible: number; showMore: () => void } {
  // SSR-safe TV flag: false on the server *and* on the hydration render,
  // so both trees agree (see useIsTvBrowser).
  const isTv = useIsTvBrowser();
  const tvInitial = isTv ? Math.max(12, Math.floor(initial / 2)) : initial;
  const tvStep = isTv ? Math.max(12, Math.floor(step / 2)) : step;

  const [state, setState] = useState({ key: resetKey, visible: tvInitial });
  // The TV answer lands after hydration, so the count seeded on the first
  // (server-matching) render is the desktop one. Reseed it once so Tizen
  // still renders half as many cards for its fast first paint.
  const seededForTv = useRef(false);
  useEffect(() => {
    if (!isTv || seededForTv.current) return;
    seededForTv.current = true;
    setState((s) => ({ ...s, visible: tvInitial }));
  }, [isTv, tvInitial]);
  if (state.key !== resetKey) {
    setState({ key: resetKey, visible: tvInitial });
    return {
      visible: tvInitial,
      showMore: () => setState((s) => ({ ...s, visible: s.visible + tvStep })),
    };
  }
  return {
    visible: state.visible,
    showMore: () => setState((s) => ({ ...s, visible: s.visible + tvStep })),
  };
}
