import { useState } from "react";
import { isTvBrowser } from "./browser";

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
  // Evaluate TV once per call — UA never changes at runtime.
  const isTv = typeof navigator !== "undefined" && isTvBrowser();
  const tvInitial = isTv ? Math.max(12, Math.floor(initial / 2)) : initial;
  const tvStep = isTv ? Math.max(12, Math.floor(step / 2)) : step;

  const [state, setState] = useState({ key: resetKey, visible: tvInitial });
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
