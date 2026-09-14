import { useState } from "react";

/**
 * Cap long grids/lists: render `initial` items, reveal `step` more per tap.
 * Resets automatically when `resetKey` changes (new tab, new search, …).
 * Render-phase reset (with previous-key guard) keeps it effect-free.
 */
export function useVisibleCount(
  resetKey: string,
  initial = 48,
  step = 48,
): { visible: number; showMore: () => void } {
  const [state, setState] = useState({ key: resetKey, visible: initial });
  if (state.key !== resetKey) {
    setState({ key: resetKey, visible: initial });
    return {
      visible: initial,
      showMore: () => setState((s) => ({ ...s, visible: s.visible + step })),
    };
  }
  return {
    visible: state.visible,
    showMore: () => setState((s) => ({ ...s, visible: s.visible + step })),
  };
}
