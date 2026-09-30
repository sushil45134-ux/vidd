/**
 * Nxsha fullscreen bot.
 *
 * Vidd used to fullscreen its own player CONTAINER when an episode opened, so
 * the user saw "Vidd's fullscreen" (container + overlay chrome) instead of the
 * Nxsha player itself. This bot instead pushes the NXSHA IFRAME ELEMENT into
 * native fullscreen the instant the embed mounts — zero extra clicks — so the
 * only thing on screen is the Nxsha player, exactly like pressing Nxsha's own
 * fullscreen button:
 *
 * 1. Instant attempt on mount (the click that opened the episode usually still
 *    carries transient user activation, so this succeeds immediately).
 * 2. If the browser blocks the instant attempt (activation expired), the bot
 *    arms one-time capture listeners so the VERY FIRST tap/click/keypress
 *    anywhere re-triggers Nxsha fullscreen — the user never has to find a
 *    fullscreen button.
 * 3. On success it best-effort locks the screen to landscape on phones, which
 *    is what Nxsha's own fullscreen button does.
 * 4. When the user exits fullscreen (Esc / back gesture) the bot respects that
 *    and does NOT force re-entry; orientation is unlocked again.
 *
 * The Nxsha player is cross-origin, so its internal fullscreen button cannot
 * be clicked programmatically — fullscreening the iframe element itself is the
 * equivalent (and only possible) mechanism from the parent page.
 */

type FullscreenCapable = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** True when an embed URL points at the Nxsha player. */
export function isNxshaEmbedUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes("nxsha");
  } catch {
    return false;
  }
}

async function tryRequestFullscreen(el: FullscreenCapable): Promise<boolean> {
  try {
    const result = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    if (result && typeof (result as Promise<void>).then === "function") {
      await result;
    }
  } catch {
    // Blocked by browser policy (no user activation) — caller retries later.
  }
  return !!document.fullscreenElement;
}

/** Best-effort landscape lock — what Nxsha's own fullscreen button does on phones. */
function lockLandscape(): void {
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    orientation?.lock?.("landscape")?.catch(() => {});
  } catch {
    // Desktop browsers reject orientation locks — that's fine.
  }
}

function unlockOrientation(): void {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Nothing to unlock.
  }
}

/**
 * Start the bot for one mounted Nxsha embed. Returns a cleanup function —
 * call it when the player unmounts or the episode changes.
 */
export function startNxshaFullscreenBot(opts: {
  /** The Nxsha iframe element — the fullscreen target. */
  iframe: HTMLIFrameElement | null;
  /** Fallback element (player container) if the iframe request is rejected. */
  fallback?: HTMLElement | null;
}): () => void {
  const { iframe, fallback } = opts;
  if (!iframe || typeof document === "undefined") return () => {};

  let disposed = false;
  let satisfied = false;
  let armed = false;
  // Set once THIS bot instance actually enters fullscreen. Needed so a stale
  // fullscreen-exit event (the previous episode's element leaving the DOM)
  // doesn't get mistaken for the user exiting and cancel the bot early.
  let everEntered = false;

  const disarm = () => {
    if (!armed) return;
    armed = false;
    window.removeEventListener("pointerdown", onFirstInteraction, true);
    window.removeEventListener("touchstart", onFirstInteraction, true);
    window.removeEventListener("keydown", onFirstInteraction, true);
  };

  const arm = () => {
    if (armed || disposed || satisfied) return;
    armed = true;
    window.addEventListener("pointerdown", onFirstInteraction, true);
    window.addEventListener("touchstart", onFirstInteraction, true);
    window.addEventListener("keydown", onFirstInteraction, true);
  };

  function onFirstInteraction() {
    // Runs inside a genuine user gesture, so fullscreen is allowed now.
    void attempt();
  }

  async function attempt(): Promise<void> {
    if (disposed || satisfied) return;

    if (document.fullscreenElement === iframe) {
      satisfied = true;
      disarm();
      lockLandscape();
      return;
    }

    // Nxsha first: fullscreen the iframe element itself so ONLY the Nxsha
    // player is on screen (no Vidd chrome) — this is "Nxsha's fullscreen".
    if (await tryRequestFullscreen(iframe as FullscreenCapable)) {
      satisfied = true;
      disarm();
      lockLandscape();
      return;
    }

    // Iframe request rejected — fall back to the container so the user still
    // gets a fullscreen experience.
    if (fallback && !document.fullscreenElement) {
      if (await tryRequestFullscreen(fallback as FullscreenCapable)) {
        satisfied = true;
        disarm();
        lockLandscape();
        return;
      }
    }

    // Nothing is fullscreen yet (activation expired) — arm the bot so the
    // very first tap/click/keypress retries instantly.
    arm();
  }

  const onFullscreenChange = () => {
    if (disposed) return;
    if (document.fullscreenElement) {
      everEntered = true;
      return;
    }
    // Ignore stale exits caused by the previous episode's fullscreen element
    // being removed from the DOM before this bot ever entered fullscreen.
    if (!everEntered) return;
    // User exited (Esc / back). Respect it — never force re-entry.
    satisfied = true;
    disarm();
    unlockOrientation();
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);

  // Instant attempt — the episode-opening click usually still has activation.
  void attempt();

  return () => {
    disposed = true;
    disarm();
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    unlockOrientation();
  };
}
