import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ListVideo,
  LoaderCircle,
  Maximize,
  Minimize,
} from "lucide-react";
import type { Movie } from "../data";
import EpisodeDrawer from "./EpisodeDrawer";
import { isTvBrowser } from "../lib/browser";
import { useIsTvBrowser } from "../hooks/useIsTvBrowser";
import { episodeTagLabel } from "../lib/playerChrome";

interface EmbedPlayerProps {
  src: string;
  kind: "iframe" | "video";
  onClose: () => void;
  /** Series queue (same playlistId) — previous episode. */
  onPrev?: () => void;
  /** Series queue (same playlistId) — next episode. */
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Resume offset in seconds — direct videos + best-effort Dailymotion seek. */
  startAt?: number;
  /** Playback clock for Continue Watching (0,0) = started, clock unknown. */
  onProgress?: (currentSec: number, durationSec: number) => void;
  /** Fired when a direct video file ends (Continue Watching cleanup). */
  onEnded?: () => void;
  /** Same-playlistId queue for the Crunchyroll-style Episodes drawer. */
  episodes?: Movie[];
  /** Index of the episode currently rendered in `episodes`. */
  currentIndex?: number;
  /** Called by the drawer when a queue row is selected. */
  onSelectEpisode?: (index: number) => void;
  /** Series/collection label shown in the player top bar and drawer. */
  seriesTitle?: string;
  /** Title for a standalone movie/upload, or the current episode title. */
  title?: string;
}

/**
 * Strip Dailymotion's own UI chrome (title, logo, next/queue button, menu,
 * social actions) so only the core video controls remain.
 */
function normalizeDailymotionUrl(url: string): string {
  try {
    let u = new URL(url);
    // Convert dai.ly short links to the proper embed URL so postMessage API works.
    if (u.hostname === "dai.ly" || u.hostname === "www.dai.ly") {
      const id = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (!id) return url;
      u = new URL(`https://www.dailymotion.com/embed/video/${id}`);
    } else if (u.hostname.includes("dailymotion.com")) {
      // Rewrite /video/<id> to /embed/video/<id> for iframe usage.
      if (!u.pathname.startsWith("/embed/")) {
        const m = u.pathname.match(/\/video\/([A-Za-z0-9]+)/);
        if (m) {
          const search = u.search;
          u = new URL(`https://www.dailymotion.com/embed/video/${m[1]}${search}`);
        }
      }
    } else {
      return url;
    }

    u.searchParams.set("autoplay", "1");
    u.searchParams.set("queue-enable", "false");
    u.searchParams.set("queue-autoplay-next", "false");
    u.searchParams.set("sharing-enable", "false");
    u.searchParams.set("ui-start-screen-info", "0");
    u.searchParams.set("ui-logo", "0");
    u.searchParams.set("ui-menu", "0");
    u.searchParams.set("ui-social-actions", "0");
    u.searchParams.set("ui-highlight", "0");
    u.searchParams.set("endscreen-enable", "false");
    u.searchParams.set("api", "postMessage");
    if (typeof window !== "undefined") {
      u.searchParams.set("origin", window.location.origin);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function getDailymotionVideoId(url: string): string | null {
  const match = url.match(
    /(?:dailymotion\.com\/video\/|dai\.ly\/|dailymotion\.com\/embed\/video\/)([A-Za-z0-9]+)/,
  );
  return match?.[1] ?? null;
}

function getDailymotionMessageEvents(data: unknown): string[] {
  const events: string[] = [];

  const visit = (value: unknown) => {
    if (!value) return;

    if (typeof value === "string") {
      const text = value.toLowerCase();
      events.push(text);

      try {
        const params = new URLSearchParams(value);
        const event = params.get("event") || params.get("command") || params.get("method");
        if (event) events.push(event.toLowerCase());
      } catch {}

      if (
        (value.startsWith("{") && value.endsWith("}")) ||
        (value.startsWith("[") && value.endsWith("]"))
      ) {
        try {
          visit(JSON.parse(value));
        } catch {}
      }
      return;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["event", "command", "method", "type", "name"]) {
        const eventValue = record[key];
        if (typeof eventValue === "string") events.push(eventValue.toLowerCase());
      }
      if (record.data && record.data !== value) visit(record.data);
      if (record.payload && record.payload !== value) visit(record.payload);
    }
  };

  visit(data);
  return events;
}

function isDailymotionStopEvent(data: unknown): boolean {
  const exactStopEvents = new Set([
    "video_end",
    "video.end",
    "video-ended",
    "videoended",
    "ended",
    "end",
    "queue",
    "next",
    "upnext",
    "up_next",
    "autoplay_next",
    "autoplaynext",
  ]);

  const rawStopPatterns = [
    "event=video_end",
    "event=end",
    "event=ended",
    "event=next",
    "event=queue",
    '"event":"video_end"',
    '"event":"end"',
    '"event":"ended"',
    '"event":"next"',
    '"event":"queue"',
    "video_end",
    "autoplay_next",
    "autoplaynext",
    "up_next",
    "upnext",
  ];

  return getDailymotionMessageEvents(data).some(
    (event) =>
      exactStopEvents.has(event) || rawStopPatterns.some((pattern) => event.includes(pattern)),
  );
}

function getDailymotionProgress(data: unknown): { currentTime?: number; duration?: number } {
  let currentTime: number | undefined;
  let duration: number | undefined;

  const readNumber = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };

  const assignByKey = (key: string, value: unknown) => {
    const normalized = key.toLowerCase().replace(/[_-]/g, "");
    const numberValue = readNumber(value);
    if (numberValue === undefined) return;

    if (["duration", "videoduration", "totalduration"].includes(normalized)) {
      duration = numberValue;
    }
    if (
      ["time", "currenttime", "current", "position", "videotime", "elapsedtime"].includes(
        normalized,
      )
    ) {
      currentTime = numberValue;
    }
  };

  const visit = (value: unknown) => {
    if (!value) return;

    if (typeof value === "string") {
      try {
        const params = new URLSearchParams(value);
        params.forEach((paramValue, key) => assignByKey(key, paramValue));
      } catch {}

      if (
        (value.startsWith("{") && value.endsWith("}")) ||
        (value.startsWith("[") && value.endsWith("]"))
      ) {
        try {
          visit(JSON.parse(value));
        } catch {}
      }
      return;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const [key, childValue] of Object.entries(record)) {
        assignByKey(key, childValue);
        if (childValue && typeof childValue === "object") visit(childValue);
        if (
          typeof childValue === "string" &&
          (childValue.includes("=") || childValue.startsWith("{"))
        )
          visit(childValue);
      }
    }
  };

  visit(data);
  return { currentTime, duration };
}

function isDailymotionLastFiveSeconds(data: unknown): boolean {
  const { currentTime, duration } = getDailymotionProgress(data);
  if (currentTime === undefined || duration === undefined) return false;
  return duration > 5 && currentTime >= 0 && duration - currentTime <= 5;
}

/**
 * Generic player for non-YouTube sources (Vimeo, Dailymotion, Odysee,
 * BitChute, Rumble, Bilibili, Twitch, Streamable, Facebook, Google Drive,
 * MEGA, arbitrary iframe embeds, and uploaded/blob video files).
 *
 * When `onPrev`/`onNext` are provided the player is part of a series queue
 * (same playlistId): Prev / Next buttons appear top-right next to fullscreen,
 * and ← / → jump between episodes inside Vidd. There is deliberately NO
 * auto-next — third-party iframes (Nxsha & co.) expose no reliable
 * end-of-video event, so the user moves to the next episode manually.
 */
export function EmbedPlayer({
  src,
  kind,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  startAt = 0,
  onProgress,
  onEnded,
  episodes,
  currentIndex = 0,
  onSelectEpisode,
  seriesTitle,
  title,
}: EmbedPlayerProps) {
  const iframeSrc = kind === "iframe" ? normalizeDailymotionUrl(src) : src;
  const isDailymotion = kind === "iframe" && /(?:dailymotion\.com|dai\.ly)/i.test(src);
  const dailymotionVideoId = isDailymotion ? getDailymotionVideoId(src) : null;
  const dailymotionReactId = useId();
  const dailymotionContainerId = `dm-player-${dailymotionReactId.replace(/[^A-Za-z0-9_-]/g, "")}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Continue Watching: throttled clock for direct <video> + Dailymotion SDK.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const latestClockRef = useRef<{ current: number; total: number } | null>(null);
  const lastReportAtRef = useRef(0);
  const dailymotionRootRef = useRef<HTMLDivElement>(null);
  const dailymotionPlayerRef = useRef<any>(null);
  const dailymotionStoppedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [isLoading, setIsLoading] = useState(() => kind === "iframe");
  const [playerSrc, setPlayerSrc] = useState(iframeSrc);
  const [isDailymotionStopped, setIsDailymotionStopped] = useState(false);

  const hasEpisodeQueue = !!episodes && episodes.length > 1;
  const safeCurrentIndex = hasEpisodeQueue
    ? Math.min(Math.max(currentIndex, 0), (episodes?.length ?? 1) - 1)
    : 0;
  const currentEpisode = hasEpisodeQueue ? episodes?.[safeCurrentIndex] : undefined;
  const episodeTag = currentEpisode ? episodeTagLabel(currentEpisode) : null;
  const chromeTitle =
    seriesTitle || currentEpisode?.playlistTitle || title || currentEpisode?.title || "Now playing";
  const chromeSubtitle = currentEpisode
    ? `${episodeTag ? `${episodeTag} · ` : ""}${currentEpisode.title}`
    : kind === "iframe"
      ? "Embedded player"
      : "Video";
  const canOpenEpisodes = hasEpisodeQueue && !!onSelectEpisode;

  useEffect(() => {
    setPlayerSrc(iframeSrc);
    setIsDailymotionStopped(false);
  }, [iframeSrc]);

  // The provider owns the cross-origin document, so the shell cannot observe
  // its actual buffering state. Show the Crunchyroll-style loader until the
  // iframe reports load (or a slow provider gets a ten-second grace period).
  useEffect(() => {
    setIsLoading(kind === "iframe");
    if (kind !== "iframe") return;
    const timeout = window.setTimeout(() => setIsLoading(false), 10000);
    return () => window.clearTimeout(timeout);
  }, [kind, src]);

  // Continue Watching clock bookkeeping (direct <video> + Dailymotion SDK).
  // The unmount flush keeps the row fresh when the player is closed.
  useEffect(() => {
    latestClockRef.current = null;
    lastReportAtRef.current = 0;
    return () => {
      const last = latestClockRef.current;
      if (last && last.total > 0) {
        try {
          onProgressRef.current?.(last.current, last.total);
        } catch {
          /* Progress listeners must never break playback. */
        }
      }
    };
  }, [src]);

  // Cross-origin iframes expose no clock — after a few seconds of playback
  // remember the title as started so it appears in Continue Watching.
  // (Dailymotion is the exception: its SDK below reports a real clock.)
  useEffect(() => {
    if (kind !== "iframe" || isDailymotion) return;
    const t = window.setTimeout(() => {
      try {
        onProgressRef.current?.(0, 0);
      } catch {
        /* Progress listeners must never break playback. */
      }
    }, 5000);
    return () => window.clearTimeout(t);
  }, [kind, src, isDailymotion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        // ← prev / → next inside Vidd's series queue. Never hijack native
        // seek on a focused <video> (uploaded files) or typing in a field.
        // On TV the D-pad belongs to spatial navigation (the Prev/Next
        // buttons stay reachable via focus + Enter), like VideoPlayer.
        const inVideo = target?.tagName === "VIDEO";
        if (!isTvBrowser() && !inField && !inVideo) {
          if (e.key === "ArrowRight" && onNext) {
            e.preventDefault();
            onNext();
            return;
          }
          if (e.key === "ArrowLeft" && onPrev) {
            e.preventDefault();
            onPrev();
            return;
          }
        }
        return;
      }

      if (e.key === "Escape") {
        if (showEpisodes) {
          setShowEpisodes(false);
        } else if (document.fullscreenElement) {
          document.exitFullscreen();
          setIsFullscreen(false);
        } else onClose();
      } else if (e.key === "f") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  // Use Dailymotion's Web SDK for Dailymotion videos. The old iframe postMessage API is
  // unreliable for current embeds, so we poll the SDK state and remove the player 5s early.
  useEffect(() => {
    if (!isDailymotion || !dailymotionVideoId) return;

    let cancelled = false;
    let progressTimer: number | undefined;
    let durationTimer: number | undefined;
    let knownDuration: number | undefined;
    let knownCurrentTime = 0;
    let lastReport = 0;

    const loadDailymotionSdk = () =>
      new Promise<any>((resolve, reject) => {
        const existing = (window as any).dailymotion;
        if (existing?.createPlayer) {
          resolve(existing);
          return;
        }

        if (!(window as any).dailymotion) {
          (window as any).dailymotion = {};
        }

        const dailymotion = (window as any).dailymotion;
        const previousOnScriptLoaded = dailymotion.onScriptLoaded;
        dailymotion.onScriptLoaded = () => {
          try {
            previousOnScriptLoaded?.();
          } catch {}
          if ((window as any).dailymotion?.createPlayer) {
            resolve((window as any).dailymotion);
          }
        };

        let script = document.querySelector<HTMLScriptElement>(
          'script[data-dailymotion-player-sdk="true"]',
        );
        if (!script) {
          script = document.createElement("script");
          script.src = "https://geo.dailymotion.com/libs/player.js";
          script.async = true;
          script.dataset.dailymotionPlayerSdk = "true";
          document.body.appendChild(script);
        }
        script.addEventListener("load", () => {
          if ((window as any).dailymotion?.createPlayer) {
            resolve((window as any).dailymotion);
          }
        });
        script.addEventListener("error", () => reject(new Error("Dailymotion SDK failed to load")));
      });

    const stopDailymotionPlayback = () => {
      if (dailymotionStoppedRef.current) return;
      dailymotionStoppedRef.current = true;
      window.clearInterval(progressTimer);
      window.clearTimeout(durationTimer);
      try {
        dailymotionPlayerRef.current?.pause?.();
      } catch {}
      try {
        dailymotionPlayerRef.current?.cancelAutoskip?.();
      } catch {}
      if (dailymotionRootRef.current) {
        dailymotionRootRef.current.innerHTML = "";
      }
      setIsDailymotionStopped(true);
      setPlayerSrc("about:blank");
    };

    const scheduleStopFromDuration = (duration: number, currentTime = 0) => {
      if (!Number.isFinite(duration) || duration <= 5) return;
      const remaining = duration - currentTime - 5;
      if (remaining <= 0) {
        stopDailymotionPlayback();
        return;
      }
      window.clearTimeout(durationTimer);
      durationTimer = window.setTimeout(stopDailymotionPlayback, remaining * 1000);
    };

    const readNumber = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return undefined;
    };

    const handleState = (state: any) => {
      if (!state || dailymotionStoppedRef.current) return;

      const duration = readNumber(state.videoDuration ?? state.duration);
      const currentTime = readNumber(state.videoTime ?? state.currentTime ?? state.time);

      if (duration && duration > 5) {
        knownDuration = duration;
      }
      if (currentTime !== undefined && currentTime >= 0) {
        knownCurrentTime = currentTime;
      }

      if (knownDuration !== undefined && durationTimer === undefined) {
        scheduleStopFromDuration(knownDuration, knownCurrentTime);
      }
      // Real clock for Continue Watching (throttled — state arrives ~2x/sec).
      if (knownDuration !== undefined && knownDuration > 5 && knownCurrentTime >= 0) {
        latestClockRef.current = { current: knownCurrentTime, total: knownDuration };
        const now = Date.now();
        if (now - lastReport > 5000) {
          lastReport = now;
          try {
            onProgressRef.current?.(knownCurrentTime, knownDuration);
          } catch {
            /* Progress listeners must never break playback. */
          }
        }
      }
      if (knownDuration !== undefined && knownDuration - knownCurrentTime <= 5) {
        stopDailymotionPlayback();
      }
    };

    dailymotionStoppedRef.current = false;
    setIsDailymotionStopped(false);

    loadDailymotionSdk()
      .then((dailymotion) => {
        if (cancelled || !dailymotionRootRef.current) return;

        dailymotionRootRef.current.innerHTML = "";
        return dailymotion.createPlayer(dailymotionContainerId, {
          video: dailymotionVideoId,
          params: {
            autoplay: true,
            mute: false,
          },
        });
      })
      .then((player: any) => {
        if (!player || cancelled) return;
        setIsLoading(false);
        dailymotionPlayerRef.current = player;

        // Best-effort resume via the Dailymotion JS API — silently ignored
        // when the SDK build does not support seeking.
        if ((startAt ?? 0) > 0 && typeof player.seek === "function") {
          const target = startAt as number;
          window.setTimeout(() => {
            try {
              player.seek(target);
            } catch {
              /* Progress listeners must never break playback. */
            }
          }, 1500);
        }

        try {
          player.setCustomConfig?.({
            enableAutonext: false,
            enableAutomaticRecommendations: false,
            enableCustomRecommendations: false,
            enableContextualContent: false,
          });
        } catch {}
        try {
          player.setCustomRecommendations?.([]);
        } catch {}

        const events = (window as any).dailymotion?.events ?? {};
        const stopEvents = [events.PLAYER_END, events.VIDEO_END, events.PLAYER_RECODISPLAY].filter(
          Boolean,
        );
        const progressEvents = [
          events.PLAYER_START,
          events.VIDEO_START,
          events.VIDEO_PLAY,
          events.VIDEO_PLAYING,
          events.VIDEO_PROGRESS,
          events.VIDEO_DURATIONCHANGE,
          events.VIDEO_SEEKEND,
        ].filter(Boolean);

        stopEvents.forEach((eventName: string) => {
          try {
            player.on(eventName, stopDailymotionPlayback);
          } catch {}
        });
        progressEvents.forEach((eventName: string) => {
          try {
            player.on(eventName, handleState);
          } catch {}
        });

        progressTimer = window.setInterval(() => {
          try {
            const state = player.getState?.();
            if (state?.then) {
              state.then(handleState).catch(() => {});
            } else {
              handleState(state);
            }
          } catch {}
        }, 500);
      })
      .catch(() => {
        // If the SDK fails, fall back to a duration-based hard stop so Dailymotion
        // still cannot show its end screen after normal playback.
      });

    if (dailymotionVideoId) {
      fetch(`https://api.dailymotion.com/video/${dailymotionVideoId}?fields=duration`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { duration?: unknown } | null) => {
          const duration = typeof data?.duration === "number" ? data.duration : undefined;
          if (!duration || duration <= 5) return;
          if (knownDuration === undefined) knownDuration = duration;
          if (durationTimer === undefined) {
            scheduleStopFromDuration(duration, knownCurrentTime ?? 0);
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      window.clearInterval(progressTimer);
      window.clearTimeout(durationTimer);
      try {
        dailymotionPlayerRef.current?.pause?.();
      } catch {}
      if (dailymotionRootRef.current) {
        dailymotionRootRef.current.innerHTML = "";
      }
      dailymotionPlayerRef.current = null;
    };
  }, [dailymotionContainerId, dailymotionVideoId, isDailymotion, startAt]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const isTv = useIsTvBrowser();
  return (
    <div
      data-tv-player-scope
      className={`${isTv ? "tv-custom-player " : ""}cr-player-shell fixed inset-0 z-[100] flex items-center justify-center bg-black animate-fadeIn`}
    >
      <div
        ref={containerRef}
        className="cr-player-surface relative h-full w-full overflow-hidden bg-black"
      >
        {kind === "iframe" && isDailymotion && dailymotionVideoId ? (
          <div
            ref={dailymotionRootRef}
            id={dailymotionContainerId}
            className="absolute inset-0 h-full w-full bg-black [&_iframe]:h-full [&_iframe]:w-full"
          />
        ) : kind === "iframe" ? (
          <iframe
            ref={iframeRef}
            src={playerSrc}
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            title="Video player"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setIsLoading(false)}
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full bg-black"
            onLoadedMetadata={(e) => {
              setIsLoading(false);
              const v = e.currentTarget;
              if ((startAt ?? 0) > 0 && v.duration > 0) {
                try {
                  v.currentTime = Math.min(startAt, Math.max(0, v.duration - 5));
                } catch {
                  /* Seeking before metadata is ready is harmless. */
                }
              }
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (!(v.duration > 0)) return;
              latestClockRef.current = { current: v.currentTime, total: v.duration };
              const now = Date.now();
              if (now - lastReportAtRef.current > 5000) {
                lastReportAtRef.current = now;
                try {
                  onProgressRef.current?.(v.currentTime, v.duration);
                } catch {
                  /* Progress listeners must never break playback. */
                }
              }
            }}
            onPause={(e) => {
              const v = e.currentTarget;
              if (!(v.duration > 0)) return;
              lastReportAtRef.current = Date.now();
              try {
                onProgressRef.current?.(v.currentTime, v.duration);
              } catch {
                /* Progress listeners must never break playback. */
              }
            }}
            onEnded={() => {
              try {
                onEndedRef.current?.();
              } catch {
                /* Progress listeners must never break playback. */
              }
            }}
            onError={() => setIsLoading(false)}
          />
        )}

        {isDailymotionStopped && <div className="absolute inset-0 z-20 bg-black" />}

        {isLoading && !isDailymotionStopped && (
          <div
            className="pointer-events-none absolute inset-0 z-[25] flex items-center justify-center"
            role="status"
            aria-label="Loading episode"
          >
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/35 px-5 py-4 backdrop-blur-sm">
              <LoaderCircle size={34} className="animate-spin text-[#f47521]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                Loading episode
              </span>
            </div>
          </div>
        )}

        {/* Dailymotion still exposes a provider-owned title bar. Cover it so
            the Vidd/Crunchyroll chrome is the only top-level identity. */}
        {isDailymotion && (
          <div className="absolute left-0 right-0 top-0 z-20 h-16 bg-black pointer-events-auto" />
        )}

        {/* Dailymotion click blockers for side next/queue, center next, and
            provider menu controls. Other iframe providers keep their native
            controls reachable because their document is cross-origin. */}
        {isDailymotion && (
          <>
            <div className="absolute right-0 top-1/4 z-20 h-1/2 w-24 bg-transparent pointer-events-auto sm:w-32" />
            <div className="absolute bottom-0 left-0 z-20 h-24 w-36 bg-transparent pointer-events-auto sm:w-44" />
            <div className="absolute bottom-0 right-0 z-20 h-24 w-44 bg-transparent pointer-events-auto sm:w-56" />
            <div
              className="absolute z-20 bg-transparent pointer-events-auto"
              style={{
                top: "50%",
                left: "55%",
                width: "12%",
                height: "18%",
                transform: "translateY(-50%)",
              }}
            />
          </>
        )}

        {/* Crunchyroll-style cinematic gradients. They do not intercept clicks,
            so Nxsha's own play bar remains usable underneath the shell. */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-32"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,.88) 0%, rgba(0,0,0,.48) 42%, transparent 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-36"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,.78) 0%, rgba(0,0,0,.28) 52%, transparent 100%)",
          }}
        />

        {/* Top bar: orange accent + episode identity, close to Crunchyroll's
            desktop/web player layout rather than a generic modal close button. */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div className="pointer-events-auto flex min-w-0 items-center gap-3">
            <button
              onClick={onClose}
              aria-label="Close player"
              className="cr-player-control flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/85"
              title="Close (Esc)"
            >
              <ArrowLeft size={21} />
            </button>
            <div className="min-w-0 max-w-[min(60vw,32rem)]">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-[#f47521]">
                {currentEpisode ? "Now watching" : "Playing"}
              </p>
              <p className="truncate text-sm font-semibold text-white sm:text-base">
                {chromeTitle}
              </p>
              <p className="truncate text-xs text-white/60">{chromeSubtitle}</p>
            </div>
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {canOpenEpisodes && (
              <button
                onClick={() => setShowEpisodes((open) => !open)}
                aria-label={showEpisodes ? "Close episode list" : "Open episode list"}
                aria-expanded={showEpisodes}
                className={`cr-player-control flex h-10 items-center gap-2 rounded-full px-3 text-xs font-bold text-white backdrop-blur-md transition-colors sm:px-4 ${
                  showEpisodes
                    ? "bg-[#f47521] text-black hover:bg-[#ff8534]"
                    : "bg-black/55 hover:bg-black/85"
                }`}
                title="Episodes"
              >
                <ListVideo size={17} />
                <span className="hidden sm:inline">Episodes</span>
                <span className="tabular-nums">{episodes?.length}</span>
              </button>
            )}
            {hasPrev && (
              <button
                onClick={onPrev}
                aria-label="Previous episode"
                className="cr-player-control flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/85"
                title="Previous episode (←)"
              >
                <ChevronLeft size={21} />
              </button>
            )}
            {hasNext && (
              <button
                onClick={onNext}
                aria-label="Next episode"
                className="cr-player-control flex h-10 w-10 items-center justify-center rounded-full bg-[#f47521] text-black backdrop-blur-md transition-colors hover:bg-[#ff8534]"
                title="Next episode (→)"
              >
                <ChevronRight size={21} />
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="cr-player-control flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/85"
              title="Fullscreen (f)"
            >
              {isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            </button>
          </div>
        </div>

        {/* The drawer intentionally sits above the chrome and the cross-origin
            iframe. Selecting an episode swaps the iframe through PlayerOverlay. */}
        {showEpisodes && canOpenEpisodes && episodes && (
          <EpisodeDrawer
            episodes={episodes}
            currentIndex={safeCurrentIndex}
            onSelectIndex={onSelectEpisode!}
            onClose={() => setShowEpisodes(false)}
            onPrev={onPrev}
            onNext={onNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
            seriesTitle={seriesTitle || currentEpisode?.playlistTitle}
          />
        )}
      </div>
    </div>
  );
}

export default EmbedPlayer;
