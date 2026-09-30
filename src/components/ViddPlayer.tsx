import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Gauge,
  Languages,
  ListVideo,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Subtitles as SubtitlesIcon,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useIsTvBrowser } from "../hooks/useIsTvBrowser";
import {
  currentFullscreenElement,
  exitFullscreen,
  lockLandscape,
  releaseOrientation,
  requestFullscreenOn,
} from "../lib/nxshaFullscreenBot";
import {
  hasNativeHlsSupport,
  isHlsUrl,
  levelLabel,
  loadHlsJs,
  trackLabel,
  type HlsInstance,
  type HlsLevel,
  type HlsTrack,
} from "../lib/mediaSource";

/**
 * VIDD PLAYER — Vidd ka apna player
 * =================================
 * Nxsha jaisa third-party iframe apne rectangle ka maalik hota hai: uske
 * controls, uska fullscreen, uska rotation. Browser parent page ko andar
 * haath daalne hi nahi deta — ye security guarantee hai, bug nahi. Isi
 * wajah se "bina ek bhi click ke Nxsha ka fullscreen" possible nahi tha.
 *
 * Ye component wo deewar hi hata deta hai. Video seedha Vidd ke apne
 * <video> element me chalti hai, to fullscreen, landscape, controls —
 * sab 100% hamare haath me. Episode kholte hi poori screen, zero clicks,
 * aur koi cross-origin rukawat nahi.
 *
 * WHAT IT HANDLES
 *   - Progressive files (mp4/webm/mkv/…) and blob: uploads
 *   - HLS (.m3u8) via hls.js, loaded from a CDN so no lockfile churn;
 *     Safari/iOS use their native HLS instead
 *   - Quality / audio track / subtitle track switching from the manifest
 *   - Speed, volume, 10s skips, seek with buffer bar, PiP-free simple UI
 *   - Auto-hiding chrome, keyboard shortcuts, TV-safe focus targets
 *   - Continue Watching clock via onProgress/onEnded
 */

export interface ViddPlayerProps {
  /** Direct media URL — mp4/webm/blob or an .m3u8 manifest. */
  src: string;
  title?: string;
  subtitle?: string;
  poster?: string;
  /** Resume offset in seconds. */
  startAt?: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Throttled playback clock for Continue Watching. */
  onProgress?: (currentSec: number, durationSec: number) => void;
  onEnded?: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const CONTROLS_HIDE_MS = 3200;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0)
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

type MenuKind = "speed" | "quality" | "audio" | "subtitles" | null;

export function ViddPlayer({
  src,
  title,
  subtitle,
  poster,
  startAt = 0,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onProgress,
  onEnded,
}: ViddPlayerProps) {
  const isTv = useIsTvBrowser();

  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);

  // Callbacks change identity every render; refs keep the effects stable.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const lastReportAtRef = useRef(0);
  const latestClockRef = useRef<{ current: number; total: number } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [menu, setMenu] = useState<MenuKind>(null);

  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [levelIndex, setLevelIndex] = useState(-1); // -1 = Auto
  const [audioTracks, setAudioTracks] = useState<HlsTrack[]>([]);
  const [audioIndex, setAudioIndex] = useState(-1);
  const [textTracks, setTextTracks] = useState<HlsTrack[]>([]);
  const [textIndex, setTextIndex] = useState(-1); // -1 = off

  /* ── Source attach (native file or HLS) ───────────────────────── */

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let cancelled = false;
    setError(null);
    setIsBuffering(true);
    setLevels([]);
    setAudioTracks([]);
    setTextTracks([]);
    setLevelIndex(-1);
    setAudioIndex(-1);
    setTextIndex(-1);

    const attachNative = () => {
      video.src = src;
      video.load();
    };

    if (!isHlsUrl(src) || hasNativeHlsSupport()) {
      attachNative();
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    // HLS in a browser without native support — hls.js does the muxing.
    loadHlsJs().then((Hls) => {
      if (cancelled || !videoRef.current) return;
      if (!Hls || !Hls.isSupported()) {
        // Last resort: some browsers still play the manifest directly.
        attachNative();
        return;
      }

      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.attachMedia(videoRef.current);
      hls.loadSource(src);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        setLevels(hls.levels ?? []);
        setAudioTracks(hls.audioTracks ?? []);
        setTextTracks(hls.subtitleTracks ?? []);
        setAudioIndex(hls.audioTrack ?? -1);
        setIsBuffering(false);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => {
        if (!cancelled) setLevelIndex(hls.currentLevel);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        const detail = data as { fatal?: boolean; type?: string };
        if (!detail?.fatal || cancelled) return;
        if (detail.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (detail.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setError("Stream load nahi ho paaya.");
        }
      });
    });

    return () => {
      cancelled = true;
      try {
        hlsRef.current?.destroy();
      } catch {
        /* Teardown must never throw during unmount. */
      }
      hlsRef.current = null;
    };
  }, [src]);

  /* ── Continue Watching: flush the last clock on unmount ───────── */

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

  /* ── Auto fullscreen + landscape, zero clicks ─────────────────── */

  // This is the whole point of owning the player: the element is ours, so
  // the Play tap's activation is spendable right here and nothing can veto
  // it. No iframe, no cross-origin rules, no provider button to hunt for.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const ok = await requestFullscreenOn(shellRef.current);
      if (!cancelled && ok) lockLandscape();
    };
    void run();
    return () => {
      cancelled = true;
      releaseOrientation();
    };
  }, [src]);

  useEffect(() => {
    const sync = () => setIsFullscreen(!!currentFullscreenElement());
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (currentFullscreenElement()) {
      exitFullscreen();
      return;
    }
    void requestFullscreenOn(shellRef.current).then((ok) => {
      if (ok) lockLandscape();
    });
  }, []);

  /* ── Playback commands ────────────────────────────────────────── */

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setIsPlaying(false));
    else video.pause();
  }, []);

  const skip = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration);
  }, []);

  const seekToFraction = useCallback((fraction: number) => {
    const video = videoRef.current;
    if (!video || !(video.duration > 0)) return;
    video.currentTime = Math.min(Math.max(0, fraction * video.duration), video.duration);
  }, []);

  const applyVolume = useCallback((next: number) => {
    const video = videoRef.current;
    const clamped = Math.min(1, Math.max(0, next));
    setVolume(clamped);
    setIsMuted(clamped === 0);
    if (video) {
      video.volume = clamped;
      video.muted = clamped === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setIsMuted(next);
  }, []);

  const applySpeed = useCallback((next: number) => {
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, []);

  /* ── Chrome auto-hide ─────────────────────────────────────────── */

  const hideTimerRef = useRef<number | undefined>(undefined);
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      // A menu left open is a conversation in progress — never hide it.
      setMenu((openMenu) => {
        if (!openMenu) setChromeVisible(false);
        return openMenu;
      });
    }, CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    wakeChrome();
    return () => window.clearTimeout(hideTimerRef.current);
  }, [wakeChrome]);

  useEffect(() => {
    if (!isPlaying) setChromeVisible(true);
  }, [isPlaying]);

  /* ── Keyboard ─────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      wakeChrome();
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(10);
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-10);
          break;
        case "ArrowUp":
          e.preventDefault();
          applyVolume(volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          applyVolume(volume - 0.1);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          toggleMute();
          break;
        case "Escape":
          if (currentFullscreenElement()) exitFullscreen();
          else onClose();
          break;
        case "n":
          if (onNext) onNext();
          break;
        case "p":
          if (onPrev) onPrev();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    applyVolume,
    onClose,
    onNext,
    onPrev,
    skip,
    toggleFullscreen,
    toggleMute,
    togglePlay,
    volume,
    wakeChrome,
  ]);

  /* ── Derived ──────────────────────────────────────────────────── */

  const progressFraction = duration > 0 ? current / duration : 0;
  const bufferedFraction = duration > 0 ? buffered / duration : 0;
  const hasQuality = levels.length > 1;
  const hasAudio = audioTracks.length > 1;
  const hasSubtitles = textTracks.length > 0;

  const speedLabel = useMemo(() => (speed === 1 ? "Normal" : `${speed}x`), [speed]);

  const chromeClass = chromeVisible ? "opacity-100" : "opacity-0 pointer-events-none";

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div
      ref={shellRef}
      className={`${isTv ? "tv-custom-player " : ""}fixed inset-0 z-[100] flex items-center justify-center bg-black animate-fadeIn`}
      onMouseMove={wakeChrome}
      onTouchStart={wakeChrome}
      data-vidd-player="true"
      data-vidd-fullscreen={isFullscreen ? "on" : "off"}
    >
      <video
        ref={videoRef}
        poster={poster}
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full bg-black"
        onClick={() => {
          wakeChrome();
          togglePlay();
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration || 0);
          v.playbackRate = speed;
          if (startAt > 0 && v.duration > 0) {
            try {
              v.currentTime = Math.min(startAt, Math.max(0, v.duration - 5));
            } catch {
              /* Seeking before metadata settles is harmless. */
            }
          }
          // Native HLS (Safari) exposes its tracks on the element itself.
          const native = Array.from(v.textTracks ?? []).map((track, i) => ({
            id: i,
            name: track.label,
            lang: track.language,
          }));
          if (native.length > 0) setTextTracks((prev) => (prev.length > 0 ? prev : native));
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setError(null);
        }}
        onCanPlay={() => setIsBuffering(false)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setIsMuted(e.currentTarget.muted);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrent(v.currentTime);
          if (v.buffered.length > 0) {
            setBuffered(v.buffered.end(v.buffered.length - 1));
          }
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
        onError={() => setError("Ye video chal nahi paayi.")}
        onEnded={() => {
          setIsPlaying(false);
          try {
            onEndedRef.current?.();
          } catch {
            /* Progress listeners must never break playback. */
          }
        }}
      />

      {/* Buffering */}
      {isBuffering && !error && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <Loader2 size={48} className="animate-spin text-white/80" />
        </div>
      )}

      {/* Hard failure */}
      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <AlertTriangle size={40} className="text-[#E50914]" />
          <p className="text-base font-semibold text-white">{error}</p>
          <p className="max-w-md text-sm text-white/60">
            Link expire ho gaya ho sakta hai, ya source ne block kiya hai.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                setError(null);
                setIsBuffering(true);
                videoRef.current?.load();
              }}
              className="rounded-full bg-[#E50914] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#f6121d]"
            >
              Dobara try karo
            </button>
            <button
              onClick={onClose}
              className="rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Band karo
            </button>
          </div>
        </div>
      )}

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div
        className={`absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-3 transition-opacity duration-300 ${chromeClass}`}
        data-tv-autohide={!chromeVisible ? "hidden" : undefined}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => {
              exitFullscreen();
              onClose();
            }}
            aria-label="Close player"
            title="Close (Esc)"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition hover:bg-black/90"
          >
            <X size={20} className="text-white" />
          </button>
          <div className="min-w-0">
            {title && <p className="truncate text-sm font-bold text-white md:text-base">{title}</p>}
            {subtitle && (
              <p className="truncate text-[11px] uppercase tracking-wide text-white/60">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {(hasPrev || hasNext) && (
            <span className="hidden items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80 sm:flex">
              <ListVideo size={14} />
              Episodes
            </span>
          )}
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            title="Fullscreen (f)"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition hover:bg-black/90"
          >
            {isFullscreen ? (
              <Minimize size={18} className="text-white" />
            ) : (
              <Maximize size={18} className="text-white" />
            )}
          </button>
        </div>
      </div>

      {/* ── Centre transport (matches what people expect from the
             provider player: 10s back, play/pause, 10s forward) ──── */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-6 transition-opacity duration-300 ${chromeClass}`}
        data-tv-autohide={!chromeVisible ? "hidden" : undefined}
      >
        <button
          onClick={() => skip(-10)}
          aria-label="Seek backward 10 seconds"
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition hover:scale-110 hover:bg-black/70"
        >
          <RotateCcw size={24} className="text-white" />
        </button>
        <button
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition hover:scale-110 hover:bg-black/70"
        >
          {isPlaying ? (
            <Pause size={34} fill="white" className="text-white" />
          ) : (
            <Play size={34} fill="white" className="ml-1 text-white" />
          )}
        </button>
        <button
          onClick={() => skip(10)}
          aria-label="Seek forward 10 seconds"
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition hover:scale-110 hover:bg-black/70"
        >
          <RotateCw size={24} className="text-white" />
        </button>
      </div>

      {/* ── Bottom bar ──────────────────────────────────────────── */}
      <div
        className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-10 transition-opacity duration-300 ${chromeClass}`}
        data-tv-autohide={!chromeVisible ? "hidden" : undefined}
      >
        {/* Seek bar */}
        <div className="mb-2 flex items-center gap-3">
          <span className="w-12 flex-shrink-0 text-xs tabular-nums text-white/80">
            {formatTime(current)}
          </span>
          <div className="tv-player-progress group/progress relative h-6 flex-1">
            <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
              <div
                className="absolute inset-y-0 left-0 bg-white/35"
                style={{ width: `${Math.min(100, bufferedFraction * 100)}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-[#E50914]"
                style={{ width: `${Math.min(100, progressFraction * 100)}%` }}
              />
            </div>
            <div
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-[#E50914] opacity-0 shadow-lg transition-opacity group-hover/progress:opacity-100"
              style={{
                left: `${Math.min(100, progressFraction * 100)}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
            <input
              type="range"
              min="0"
              max="1000"
              step="1"
              aria-label="Video progress"
              value={Math.round(progressFraction * 1000)}
              onChange={(e) => seekToFraction(Number(e.target.value) / 1000)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <span className="w-12 flex-shrink-0 text-right text-xs tabular-nums text-white/80">
            {formatTime(duration)}
          </span>
        </div>

        {/* Control row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-9 w-9 items-center justify-center transition hover:scale-110"
            >
              {isPlaying ? (
                <Pause size={20} fill="white" className="text-white" />
              ) : (
                <Play size={20} fill="white" className="text-white" />
              )}
            </button>

            {hasPrev && onPrev && (
              <button
                onClick={onPrev}
                aria-label="Previous episode"
                title="Previous episode (p)"
                className="flex h-9 w-9 items-center justify-center transition hover:scale-110"
              >
                <SkipBack size={18} className="text-white" />
              </button>
            )}
            {hasNext && onNext && (
              <button
                onClick={onNext}
                aria-label="Next episode"
                title="Next episode (n)"
                className="flex h-9 w-9 items-center justify-center transition hover:scale-110"
              >
                <SkipForward size={18} className="text-white" />
              </button>
            )}

            <div className="group/volume flex items-center gap-1">
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="flex h-9 w-9 items-center justify-center transition hover:scale-110"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX size={19} className="text-white" />
                ) : (
                  <Volume2 size={19} className="text-white" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                aria-label="Volume"
                value={isMuted ? 0 : Math.round(volume * 100)}
                onChange={(e) => applyVolume(Number(e.target.value) / 100)}
                className={`volume-slider transition-all duration-200 ${
                  isTv
                    ? "w-20 opacity-100"
                    : "w-0 opacity-0 group-hover/volume:w-20 group-hover/volume:opacity-100"
                }`}
              />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <MenuButton
              icon={<Gauge size={16} />}
              label="Speed"
              value={speedLabel}
              open={menu === "speed"}
              onToggle={() => setMenu((m) => (m === "speed" ? null : "speed"))}
              options={SPEEDS.map((s) => ({
                id: String(s),
                label: s === 1 ? "Normal" : `${s}x`,
                active: s === speed,
              }))}
              onPick={(id) => {
                applySpeed(Number(id));
                setMenu(null);
              }}
            />

            {hasSubtitles && (
              <MenuButton
                icon={<SubtitlesIcon size={16} />}
                label="Subtitles"
                open={menu === "subtitles"}
                onToggle={() => setMenu((m) => (m === "subtitles" ? null : "subtitles"))}
                options={[
                  { id: "-1", label: "Off", active: textIndex === -1 },
                  ...textTracks.map((t, i) => ({
                    id: String(i),
                    label: trackLabel(t, i),
                    active: textIndex === i,
                  })),
                ]}
                onPick={(id) => {
                  const next = Number(id);
                  setTextIndex(next);
                  const hls = hlsRef.current;
                  if (hls) {
                    hls.subtitleTrack = next;
                    hls.subtitleDisplay = next !== -1;
                  } else if (videoRef.current) {
                    Array.from(videoRef.current.textTracks ?? []).forEach((track, i) => {
                      track.mode = i === next ? "showing" : "disabled";
                    });
                  }
                  setMenu(null);
                }}
              />
            )}

            {hasAudio && (
              <MenuButton
                icon={<Languages size={16} />}
                label="Audio"
                open={menu === "audio"}
                onToggle={() => setMenu((m) => (m === "audio" ? null : "audio"))}
                options={audioTracks.map((t, i) => ({
                  id: String(i),
                  label: trackLabel(t, i),
                  active: audioIndex === i,
                }))}
                onPick={(id) => {
                  const next = Number(id);
                  setAudioIndex(next);
                  if (hlsRef.current) hlsRef.current.audioTrack = next;
                  setMenu(null);
                }}
              />
            )}

            {hasQuality && (
              <MenuButton
                icon={<span className="text-[11px] font-bold">HD</span>}
                label="Quality"
                value={
                  levelIndex === -1 ? "Auto" : levelLabel(levels[levelIndex] ?? {}, levelIndex)
                }
                open={menu === "quality"}
                onToggle={() => setMenu((m) => (m === "quality" ? null : "quality"))}
                options={[
                  { id: "-1", label: "Auto", active: levelIndex === -1 },
                  ...levels.map((l, i) => ({
                    id: String(i),
                    label: levelLabel(l, i),
                    active: levelIndex === i,
                  })),
                ]}
                onPick={(id) => {
                  const next = Number(id);
                  setLevelIndex(next);
                  if (hlsRef.current) hlsRef.current.currentLevel = next;
                  setMenu(null);
                }}
              />
            )}

            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="flex h-9 w-9 items-center justify-center transition hover:scale-110"
            >
              {isFullscreen ? (
                <Minimize size={19} className="text-white" />
              ) : (
                <Maximize size={19} className="text-white" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small settings menu (Speed / Subtitles / Audio / Quality)
 * ------------------------------------------------------------------ */

function MenuButton({
  icon,
  label,
  value,
  open,
  onToggle,
  options,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  open: boolean;
  onToggle: () => void;
  options: { id: string; label: string; active: boolean }[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition ${
          open ? "bg-[#E50914] text-white" : "text-white hover:bg-white/15"
        }`}
      >
        <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
        <span className="hidden sm:inline">{label}</span>
        {value && <span className="hidden text-white/70 md:inline">({value})</span>}
      </button>

      {open && (
        <div className="absolute bottom-11 right-0 z-40 max-h-64 min-w-[10rem] overflow-y-auto rounded-xl border border-white/10 bg-black/95 py-1.5 shadow-2xl backdrop-blur-xl">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => onPick(option.id)}
              className={`block w-full px-4 py-2 text-left text-sm transition ${
                option.active
                  ? "bg-white/10 font-semibold text-[#E50914]"
                  : "text-white/85 hover:bg-white/10"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ViddPlayer;
