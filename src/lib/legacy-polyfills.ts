/**
 * Loads polyfills needed for legacy Chromium engines (Samsung Tizen, older
 * Smart TV browsers). Kept in a separate module so we can dynamic-import it
 * only in the browser and keep the SSR bundle small.
 */
export async function loadLegacyPolyfills(): Promise<void> {
  if (typeof window === "undefined") return;

  // core-js pieces the legacy plugin's modernPolyfills may miss on very old engines.
  await import("core-js/features/promise/all-settled");
  await import("core-js/features/object/from-entries");
  await import("core-js/features/string/replace-all");
  await import("core-js/features/array/flat");
  await import("core-js/features/array/flat-map");

  // IntersectionObserver polyfill (native side-effect import).
  if (!("IntersectionObserver" in window)) {
    await import("intersection-observer");
  }

  // ResizeObserver polyfill via @juggle/resize-observer.
  const w = window as unknown as { ResizeObserver?: unknown };
  if (!w.ResizeObserver) {
    const mod = await import("@juggle/resize-observer");
    w.ResizeObserver = mod.ResizeObserver as unknown as typeof ResizeObserver;
  }
}
