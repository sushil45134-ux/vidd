import { useEffect, useRef } from "react";

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
  removeEventListener?: (type: "release", listener: () => void) => void;
}

interface WakeLockLike {
  request?: (type: "screen") => Promise<WakeLockSentinelLike>;
}

interface AndroidScreenBridge {
  setKeepScreenOn?: (keepScreenOn: boolean) => void;
}

function getWakeLock(): { request: (type: "screen") => Promise<WakeLockSentinelLike> } | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
  const request = candidate?.request;
  return request ? { request } : null;
}

/**
 * Keep the display awake for an active player on Android.
 *
 * Screen Wake Lock is deliberately managed in one place because players in
 * this app are a mix of YouTube, cross-origin iframe providers, and native
 * HTML video. Cross-origin iframes do not expose their play/pause events to
 * the parent, so the caller should keep `enabled` true for the lifetime of an
 * iframe player and while a direct video is playing.
 *
 * Android releases a wake lock when a tab is hidden. The visibility listener
 * reacquires it when the user comes back. Pointer/keyboard listeners provide a
 * user-activation path for Android WebViews/browsers that reject a request
 * made only from a later React effect.
 *
 * The optional ViddAndroid bridge is used by the packaged Android WebView as
 * a native fallback for WebViews which do not implement the Screen Wake Lock
 * API. It is a no-op in a normal browser.
 */
export function useScreenWakeLock(enabled: boolean) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let disposed = false;
    let sentinel: WakeLockSentinelLike | null = null;
    let requestInFlight: Promise<WakeLockSentinelLike> | null = null;

    const setNativeKeepScreenOn = (keepScreenOn: boolean) => {
      if (typeof window === "undefined") return;
      try {
        const bridge = (window as Window & { ViddAndroid?: AndroidScreenBridge }).ViddAndroid;
        bridge?.setKeepScreenOn?.(keepScreenOn);
      } catch {
        // A native bridge is optional and must never affect web playback.
      }
    };

    const onSentinelReleased = () => {
      sentinel = null;
      if (!disposed && enabledRef.current && document.visibilityState === "visible") {
        void acquire();
      }
    };

    const acquire = async () => {
      if (
        disposed ||
        !enabledRef.current ||
        document.visibilityState !== "visible" ||
        (sentinel && sentinel.released !== true)
      ) {
        return;
      }

      // This native fallback is useful even when the browser API is missing.
      // Set it before requesting the web lock so a WebView cannot time out
      // during the asynchronous request.
      setNativeKeepScreenOn(true);

      const wakeLock = getWakeLock();
      if (!wakeLock || requestInFlight) return;

      requestInFlight = wakeLock.request("screen");
      try {
        const next = await requestInFlight;
        if (disposed || !enabledRef.current || document.visibilityState !== "visible") {
          await next.release().catch(() => {});
          return;
        }
        sentinel = next;
        next.addEventListener?.("release", onSentinelReleased);
      } catch {
        // Permission policy, insecure origins, battery saver, and old Android
        // WebViews can all reject this. Native fallback/playback still works.
      } finally {
        requestInFlight = null;
      }
    };

    const release = () => {
      setNativeKeepScreenOn(false);
      const current = sentinel;
      sentinel = null;
      if (!current) return;
      current.removeEventListener?.("release", onSentinelReleased);
      void current.release().catch(() => {});
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
      else release();
    };

    // Some Android browsers require a user-activation-adjacent call. These
    // listeners are capture-phase and passive, so they never interfere with
    // the provider controls or the app's keyboard navigation.
    const onUserActivity = () => {
      if (enabledRef.current) void acquire();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("pointerdown", onUserActivity, true);
    document.addEventListener("touchstart", onUserActivity, { capture: true, passive: true });
    document.addEventListener("keydown", onUserActivity, true);
    document.addEventListener("click", onUserActivity, true);

    if (enabled) void acquire();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerdown", onUserActivity, true);
      document.removeEventListener("touchstart", onUserActivity, true);
      document.removeEventListener("keydown", onUserActivity, true);
      document.removeEventListener("click", onUserActivity, true);
      release();
    };
  }, [enabled]);
}

export default useScreenWakeLock;
