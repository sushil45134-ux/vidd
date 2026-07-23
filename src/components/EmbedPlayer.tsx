import { useEffect, useId, useRef, useState } from "react";
import { X, Maximize, Minimize } from "lucide-react";

interface EmbedPlayerProps {
  src: string;
  kind: "iframe" | "video";
  onClose: () => void;
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
  const match = url.match(/(?:dailymotion\.com\/video\/|dai\.ly\/|dailymotion\.com\/embed\/video\/)([A-Za-z0-9]+)/);
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

      if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
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
    (event) => exactStopEvents.has(event) || rawStopPatterns.some((pattern) => event.includes(pattern)),
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
    if (["time", "currenttime", "current", "position", "videotime", "elapsedtime"].includes(normalized)) {
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

      if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
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
        if (typeof childValue === "string" && (childValue.includes("=") || childValue.startsWith("{"))) visit(childValue);
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
 * arbitrary iframe embeds, and uploaded/blob video files).
 */
export function EmbedPlayer({ src, kind, onClose }: EmbedPlayerProps) {
  const iframeSrc = kind === "iframe" ? normalizeDailymotionUrl(src) : src;
  const isDailymotion = kind === "iframe" && /(?:dailymotion\.com|dai\.ly)/i.test(src);
  const dailymotionVideoId = isDailymotion ? getDailymotionVideoId(src) : null;
  const dailymotionReactId = useId();
  const dailymotionContainerId = `dm-player-${dailymotionReactId.replace(/[^A-Za-z0-9_-]/g, "")}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dailymotionRootRef = useRef<HTMLDivElement>(null);
  const dailymotionPlayerRef = useRef<any>(null);
  const dailymotionStoppedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerSrc, setPlayerSrc] = useState(iframeSrc);
  const [isDailymotionStopped, setIsDailymotionStopped] = useState(false);

  useEffect(() => {
    setPlayerSrc(iframeSrc);
    setIsDailymotionStopped(false);
  }, [iframeSrc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
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

        let script = document.querySelector<HTMLScriptElement>('script[data-dailymotion-player-sdk="true"]');
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
        dailymotionPlayerRef.current = player;

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
        const stopEvents = [events.PLAYER_END, events.VIDEO_END, events.PLAYER_RECODISPLAY].filter(Boolean);
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
  }, [dailymotionContainerId, dailymotionVideoId, isDailymotion]);


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

  return (
    <div
      className={
        kind === "video"
          ? "tv-player-overlay relative z-[100] bg-black animate-fadeIn flex items-center justify-center"
          : "tv-player-overlay fixed inset-0 z-[100] bg-black animate-fadeIn flex items-center justify-center"
      }
    >
      <div
        ref={containerRef}
        className={`${kind === "video" ? "tv-native-video-frame" : "tv-player-frame relative w-full h-full"} bg-black`}
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
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            title="Video player"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            {...({ "webkit-playsinline": "true", "x5-playsinline": "true" } as any)}
            className="tv-native-video w-full"
            style={{
              position: "relative",
              zIndex: 1,
              display: "block",
              width: "100%",
              maxWidth: "100%",
              height: "auto",
              maxHeight: "100vh",
              margin: "0 auto",
              backgroundColor: "#000",
              transform: "translateZ(0)",
              WebkitTransform: "translateZ(0)",
              objectFit: "contain",
            }}
          />
        )}

        {isDailymotionStopped && <div className="absolute inset-0 z-20 bg-black" />}

        {/* Dailymotion top title/logo bar cover */}
        {isDailymotion && (
          <div className="absolute top-0 left-0 right-0 h-16 z-20 bg-black pointer-events-auto" />
        )}

        {/* Dailymotion click blockers for side next/queue, center next, and video-change/menu controls */}
        {isDailymotion && (
          <>
            <div className="absolute right-0 top-1/4 h-1/2 w-24 sm:w-32 z-20 pointer-events-auto bg-transparent" />
            <div className="absolute bottom-0 left-0 h-24 w-36 sm:w-44 z-20 pointer-events-auto bg-transparent" />
            <div className="absolute bottom-0 right-0 h-24 w-44 sm:w-56 z-20 pointer-events-auto bg-transparent" />
            {/* Center-right next arrow blocker (next to play button) */}
            <div
              className="absolute z-20 pointer-events-auto bg-transparent"
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

        {/* Top gradient */}
        <div
          className="absolute top-0 left-0 right-0 h-24 z-20 pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)",
          }}
        />


        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 z-30 w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 flex items-center justify-center transition-all backdrop-blur-sm"
          title="Close (Esc)"
        >
          <X size={22} className="text-white" />
        </button>

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-30 w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 flex items-center justify-center transition-all backdrop-blur-sm"
          title="Fullscreen (f)"
        >
          {isFullscreen ? (
            <Minimize size={20} className="text-white" />
          ) : (
            <Maximize size={20} className="text-white" />
          )}
        </button>
      </div>
    </div>
  );
}

export default EmbedPlayer;
