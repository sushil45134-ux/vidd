import { useState, useRef, useEffect, useCallback } from "react";
import { registerTvBackHandler } from "../lib/spatialNav";
import { isTvBrowser } from "../lib/browser";
import type { YouTubePlayer, YouTubeWindow, YouTubeEvent } from "../lib/youtubePlayer";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipBack,
  SkipForward,
  X,
  Settings,
  Subtitles,
  Check,
  LayoutTemplate,
  Bookmark,
  ListPlus,
  ListVideo,
} from "lucide-react";

interface QueueItem {
  youtubeId: string;
  title?: string;
  thumbnail?: string;
}

interface VideoPlayerProps {
  videoId: string;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  onPlayStart?: (videoId: string, title: string) => void;
  onSaveToWatchLater?: (videoId: string, title: string) => void;
  onSaveToPlaylist?: (videoId: string, title: string) => void;
  autoPlay?: boolean;
  queueItems?: QueueItem[];
  currentQueueIndex?: number;
  onJumpTo?: (index: number) => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** TV-only: hide the custom controls after this much remote/pointer silence. */
const TV_CONTROLS_IDLE_MS = 3000;

/** Remote keys that may only wake hidden controls (D-pad + OK/Enter). */
const TV_WAKE_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "NumpadEnter",
  " ",
  "Spacebar",
]);

interface SubtitleTrack {
  lang: string;
  name: string;
}

export function VideoPlayer({
  videoId,
  onClose,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  onPlayStart,
  onSaveToWatchLater,
  onSaveToPlaylist,
  autoPlay = true,
  queueItems,
  currentQueueIndex,
  onJumpTo,
}: VideoPlayerProps) {
  const isTv = isTvBrowser();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState("0:00");
  const [duration, setDuration] = useState("0:00");
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheater, setIsTheater] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [videoTitle, setVideoTitle] = useState("");
  const [showQueue, setShowQueue] = useState(false);
  // TV first reuses the desktop API/custom controls. Native controls are
  // reserved for the emergency embed when the API cannot become usable.
  const [useSimpleEmbed, setUseSimpleEmbed] = useState(false);
  // TV fallback chain: 0 = youtube.com embed, 1 = youtube-nocookie embed.
  const [tvStage, setTvStage] = useState(0);
  // After a grace period, offer remote-focusable recovery actions in case
  // the embed cannot start (network / codec / Error-153 style referrer issues).
  const [showTvFallback, setShowTvFallback] = useState(false);
  // TV-only auto-hide (desktop keeps its `showControls` behaviour untouched).
  // Bumping `tvIdleTick` restarts the inactivity timer.
  const [tvControlsHidden, setTvControlsHidden] = useState(false);
  const [tvIdleTick, setTvIdleTick] = useState(0);

  // Remote BACK closes the player first (on top of the details modal).
  useEffect(() => registerTvBackHandler(onClose), [onClose]);

  // If the plain embed has not visibly started after 15s, surface recovery
  // actions. Purely advisory — never blocks a video that is just slow.
  useEffect(() => {
    if (!useSimpleEmbed) return;
    const t = setTimeout(() => setShowTvFallback(true), 15000);
    return () => clearTimeout(t);
  }, [useSimpleEmbed, videoId, tvStage]);

  useEffect(() => {
    setShowTvFallback(false);
  }, [videoId, tvStage]);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Subtitles state
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);

  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ytPlayerRef = useRef<YouTubePlayer | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const settingsRef = useRef<HTMLDivElement>(null);
  const subtitlesRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const tvControlsHiddenRef = useRef(false);
  const tvLastActivityRef = useRef(0);
  const tvRestoreFocusRef = useRef<HTMLElement | null>(null);

  /**
   * TV-only: reveal the controls and restart the inactivity timer. Called for
   * remote input and pointer movement. Throttled while already visible so a
   * stream of mousemove events does not re-render on every pixel.
   */
  const touchTvControls = useCallback(() => {
    if (!isTv || useSimpleEmbed) return;
    const now = Date.now();
    if (!tvControlsHiddenRef.current && now - tvLastActivityRef.current < 500) return;
    tvLastActivityRef.current = now;
    tvControlsHiddenRef.current = false;
    setTvControlsHidden(false);
    setTvIdleTick((tick) => tick + 1);
  }, [isTv, useSimpleEmbed]);

  const hideTvControls = useCallback(() => {
    tvControlsHiddenRef.current = true;
    setTvControlsHidden(true);
  }, []);

  // Auto-hide is TV-only and only while custom (API) playback is actually
  // running. Paused, buffering, settings/subtitles/queue open → stay visible.
  useEffect(() => {
    if (!isTv || useSimpleEmbed) return;
    const canHide = isPlaying && !isBuffering && !showSettings && !showSubtitlesMenu && !showQueue;
    if (!canHide) {
      tvControlsHiddenRef.current = false;
      setTvControlsHidden(false);
      return;
    }
    const timer = setTimeout(hideTvControls, TV_CONTROLS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [
    isTv,
    useSimpleEmbed,
    isPlaying,
    isBuffering,
    showSettings,
    showSubtitlesMenu,
    showQueue,
    tvIdleTick,
    hideTvControls,
  ]);

  // Hidden controls must not stay clickable or spatial-focusable, so focus is
  // parked on the host player and restored to the previous button on reveal.
  useEffect(() => {
    if (!isTv || useSimpleEmbed) return;
    if (tvControlsHidden) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && playerRef.current?.contains(active)) {
        tvRestoreFocusRef.current = active;
      }
      try {
        playerRef.current?.focus({ preventScroll: true });
      } catch (_) {
        playerRef.current?.focus();
      }
      return;
    }
    const restore = tvRestoreFocusRef.current;
    tvRestoreFocusRef.current = null;
    if (!restore?.isConnected) return;
    try {
      restore.focus({ preventScroll: true });
    } catch (_) {
      restore.focus();
    }
  }, [isTv, useSimpleEmbed, tvControlsHidden]);

  // The first D-pad/OK press after auto-hide only wakes the controls — it must
  // not seek, toggle play/pause or leave fullscreen. Everything else (media
  // keys, BACK) keeps its existing meaning.
  useEffect(() => {
    if (!isTv || useSimpleEmbed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.keyCode === 10009 ||
        e.keyCode === 461 ||
        e.key === "GoBack" ||
        e.key === "BrowserBack"
      ) {
        return;
      }
      // Older TV engines may surface only keyCode, so check both channels.
      const isWakeKey =
        TV_WAKE_KEYS.has(e.key) ||
        e.keyCode === 13 ||
        e.keyCode === 32 ||
        (e.keyCode >= 37 && e.keyCode <= 40);
      if (tvControlsHiddenRef.current && isWakeKey) {
        e.preventDefault();
        e.stopPropagation();
        touchTvControls();
        return;
      }
      // Any other remote input (media keys, navigation while visible) resets
      // the inactivity timer.
      touchTvControls();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isTv, useSimpleEmbed, touchTvControls]);

  // Resume from a source switch / app background must never land the viewer
  // on a hidden bar: treat the app becoming visible again as activity and
  // force a fresh countdown (bypassing the mousemove throttle).
  useEffect(() => {
    if (!isTv || useSimpleEmbed) return;
    const onVisibility = () => {
      if (document.hidden) return;
      tvLastActivityRef.current = 0;
      touchTvControls();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isTv, useSimpleEmbed, touchTvControls]);

  // Keep focus in the host page (never the cross-origin custom-mode iframe).
  // The same spatial navigator and LIFO BACK stack continue to own the remote.
  useEffect(() => {
    if (!isTv) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = useSimpleEmbed
      ? playerRef.current?.querySelector<HTMLButtonElement>("button")
      : playButtonRef.current;
    target?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [isTv, useSimpleEmbed]);

  // Initialize YouTube Player API
  useEffect(() => {
    hasStartedRef.current = false;
    setVideoTitle("");
    setIsBuffering(true);
    setProgress(0);
    setCurrentTime("0:00");
    setDuration("0:00");
    let cancelled = false;
    const playerContainer = containerRef.current;
    const ytWindow = window as unknown as YouTubeWindow;

    // Emergency embed needs no API and must never retain the app spinner.
    if (useSimpleEmbed) {
      setIsBuffering(false);
      return () => {
        cancelled = true;
      };
    }

    // Load the YouTube IFrame API script once per page. Never depend on other
    // <script> tags existing — append to <head> directly.
    const API_SRC = "https://www.youtube.com/iframe_api";
    let apiScript = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    const newScript = !apiScript;
    if (!apiScript) {
      apiScript = document.createElement("script");
      apiScript.src = API_SRC;
    }

    let mountNode: HTMLDivElement | null = null;
    let autoplayCheckTimer: ReturnType<typeof setTimeout> | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let createdPlayer: typeof ytPlayerRef.current = null;
    let tvFailed = false;
    const fallbackOnTv = () => {
      if (!isTv || cancelled || tvFailed) return;
      tvFailed = true;
      clearTimeout(readyTimer);
      setIsBuffering(false);
      setIsPlaying(false);
      setShowQueue(false);
      setUseSimpleEmbed(true);
    };
    if (isTv) {
      // Covers missing script/callback AND a constructed player that never
      // emits onReady. Separate from the desktop autoplay-check timer.
      readyTimer = setTimeout(fallbackOnTv, 10000);
      apiScript.addEventListener("error", fallbackOnTv);
    }
    if (newScript) document.head.appendChild(apiScript);

    const initPlayer = () => {
      if (cancelled || tvFailed || !containerRef.current) return;
      if (isTv && createdPlayer) return;
      if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
        ytPlayerRef.current.loadVideoById(videoId);
        if (autoPlay) ytPlayerRef.current.playVideo();
        return;
      }
      // YT.Player REPLACES the element it is given with an <iframe>. If we
      // passed our React-rendered div by id, the div would be consumed: after
      // destroy() (React StrictMode's double-invoked effects, or the
      // key-remounts from PlayerOverlay) the element is gone and the next
      // `new YT.Player("yt-player", …)` throws "element not found" — the
      // video then never loads (infinite spinner). Instead, mount the player
      // on a disposable node React does not manage, created fresh per effect
      // run, so remounts always have a valid target.
      mountNode = document.createElement("div");
      mountNode.style.width = "100%";
      mountNode.style.height = "100%";
      containerRef.current.appendChild(mountNode);
      const player = new ytWindow.YT.Player(mountNode, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: autoPlay ? 1 : 0,
          controls: 0,
          ...(isTv ? { enablejsapi: 1 } : {}),
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          fs: 0,
          disablekb: 1,
          playsinline: 1,
          cc_load_policy: 0,
          cc_lang_pref: "",
          hl: "en",
          origin: window.location.origin,
        },
        events: {
          onReady: (event: YouTubeEvent) => {
            if (cancelled || tvFailed) return;
            const p = event.target;
            ytPlayerRef.current = p;
            try {
              p.setVolume(volume);
              if (autoPlay) p.playVideo();
            } catch (error) {
              if (!isTv) throw error;
              fallbackOnTv();
              return;
            }
            if (isTv) clearTimeout(readyTimer);
            setIsBuffering(false);

            // If the browser blocks programmatic autoplay (common on first
            // visit), YouTube may not fire any state event — make sure the
            // spinner clears and the center play button becomes clickable.
            autoplayCheckTimer = setTimeout(() => {
              if (cancelled || hasStartedRef.current) return;
              try {
                const st = p.getPlayerState?.();
                // 1 = playing, 3 = buffering — the video is genuinely on its
                // way; leave the UI alone.
                if (st === 1 || st === 3) return;
              } catch (_) {
                /* Optional provider APIs may be unavailable. */
              }
              setIsBuffering(false);
              setIsPlaying(false);
            }, 2500);

            try {
              const title = p.getVideoData && p.getVideoData()?.title;
              if (title) setVideoTitle(title);
            } catch (_) {
              /* Optional provider APIs may be unavailable. */
            }

            try {
              p.unloadModule("captions");
              p.unloadModule("cc");
            } catch (_) {
              /* Optional provider APIs may be unavailable. */
            }
            try {
              p.setOption("captions", "track", {});
              p.setOption("cc", "track", {});
            } catch (_) {
              /* Optional provider APIs may be unavailable. */
            }

            setTimeout(() => {
              if (isTv && (cancelled || tvFailed)) return;
              try {
                const tracks = p.getOption("captions", "tracklist");
                if (tracks && tracks.length > 0) {
                  const parsed: SubtitleTrack[] = tracks.map((t) => ({
                    lang: t.languageCode || t.vss_id || "unknown",
                    name: t.languageName || t.displayName || t.languageCode || "Unknown",
                  }));
                  setSubtitleTracks(parsed);
                }
              } catch (_) {
                /* Optional provider APIs may be unavailable. */
              }
            }, 2000);

            progressIntervalRef.current = setInterval(() => {
              const inst = ytPlayerRef.current;
              if (
                inst &&
                typeof inst.getCurrentTime === "function" &&
                typeof inst.getDuration === "function"
              ) {
                try {
                  const current = inst.getCurrentTime();
                  const total = inst.getDuration();
                  if (total > 0) {
                    setProgress((current / total) * 100);
                    setCurrentTime(formatTime(current));
                    setDuration(formatTime(total));
                  }
                } catch (_) {
                  /* Optional provider APIs may be unavailable. */
                }
              }
            }, 500);
          },
          ...(isTv ? { onError: fallbackOnTv } : {}),
          onStateChange: (event: YouTubeEvent) => {
            if (isTv && (cancelled || tvFailed)) return;
            const YT = ytWindow.YT;
            const p = event.target;
            if (isTv && event.data !== YT.PlayerState.BUFFERING) setIsBuffering(false);

            if (!activeSubtitle) {
              try {
                if (p.unloadModule) p.unloadModule("captions");
                if (p.unloadModule) p.unloadModule("cc");
              } catch (_) {
                /* Optional provider APIs may be unavailable. */
              }
              try {
                if (p.setOption) p.setOption("captions", "track", {});
              } catch (_) {
                /* Optional provider APIs may be unavailable. */
              }
            }

            if (event.data === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              setIsBuffering(false);
              let title = "Now Playing";
              try {
                title = (p.getVideoData && p.getVideoData()?.title) || "Now Playing";
              } catch (_) {
                /* Optional provider APIs may be unavailable. */
              }
              setVideoTitle(title);
              if (!hasStartedRef.current) {
                hasStartedRef.current = true;
                onPlayStart?.(videoId, title);
              }
            } else if (event.data === YT.PlayerState.PAUSED) {
              setIsPlaying(false);
            } else if (event.data === YT.PlayerState.BUFFERING) {
              setIsBuffering(true);
            } else if (event.data === YT.PlayerState.UNSTARTED) {
              // Player is idle (e.g. autoplay was blocked) — never leave the
              // spinner running or claim we are playing.
              setIsPlaying(false);
              setIsBuffering(false);
            } else if (event.data === YT.PlayerState.ENDED) {
              setIsPlaying(false);
              setProgress(100);
              if (onNext) onNext();
            }
          },
        },
      });
      createdPlayer = player;
      // TV controls cannot call incomplete methods before onReady. Desktop
      // retains its existing reference/initialization behavior.
      if (!isTv) ytPlayerRef.current = player;
      // The API replaces mountNode with an <iframe> that does NOT inherit our
      // styles/classes — size it explicitly so it fills the crop wrapper.
      try {
        const iframe = containerRef.current?.querySelector("iframe");
        if (iframe) {
          iframe.style.width = "100%";
          iframe.style.height = "100%";
          iframe.style.position = "absolute";
          iframe.style.top = "0";
          iframe.style.left = "0";
          iframe.style.border = "0";
          if (isTv) {
            iframe.tabIndex = -1;
            iframe.setAttribute("aria-hidden", "true");
            iframe.referrerPolicy = "no-referrer-when-downgrade";
          }
        }
      } catch (_) {
        /* Optional provider APIs may be unavailable. */
      }
    };

    const startPlayer = () => {
      if (!isTv) return initPlayer();
      try {
        initPlayer();
      } catch (_) {
        fallbackOnTv();
      }
    };
    const previousApiReady = ytWindow.onYouTubeIframeAPIReady;
    if (ytWindow.YT && ytWindow.YT.Player) {
      startPlayer();
    } else {
      ytWindow.onYouTubeIframeAPIReady = startPlayer;
      // Slow/older TV browsers may never call onYouTubeIframeAPIReady. Do not
      // leave viewers looking at an infinite spinner in that case.
      if (!isTv)
        autoplayCheckTimer = setTimeout(() => {
          if (!cancelled && !ytPlayerRef.current) {
            setIsBuffering(false);
            setUseSimpleEmbed(true);
          }
        }, 8000);
    }

    return () => {
      cancelled = true;
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (autoplayCheckTimer) clearTimeout(autoplayCheckTimer);
      if (isTv) {
        clearTimeout(readyTimer);
        apiScript.removeEventListener("error", fallbackOnTv);
        if (ytWindow.onYouTubeIframeAPIReady === startPlayer) {
          ytWindow.onYouTubeIframeAPIReady = previousApiReady;
        }
      }
      const inst = isTv ? createdPlayer : ytPlayerRef.current;
      ytPlayerRef.current = null;
      if (inst && typeof inst.destroy === "function") {
        try {
          inst.destroy();
        } catch (_) {
          /* Optional provider APIs may be unavailable. */
        }
      }
      // Remove anything the player left behind (iframe / mount node) so the
      // next mount starts from a clean container.
      if (playerContainer) {
        try {
          playerContainer.innerHTML = "";
        } catch (_) {
          /* Optional provider APIs may be unavailable. */
        }
      }
    };
    // Preserve the existing mount-per-video lifecycle: volume/menu/playing
    // changes must not destroy and recreate the desktop or TV player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, useSimpleEmbed, isTv]);

  // Also bound a provider buffering stall after onReady. The native embed
  // has its own loading UI; the app spinner never covers emergency playback.
  useEffect(() => {
    if (!isTv || useSimpleEmbed || !isBuffering) return;
    const timer = setTimeout(() => {
      setIsBuffering(false);
      setIsPlaying(false);
      setShowQueue(false);
      setUseSimpleEmbed(true);
    }, 15000);
    return () => clearTimeout(timer);
  }, [isTv, useSimpleEmbed, isBuffering]);

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0)
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const togglePlay = useCallback(() => {
    if (!ytPlayerRef.current) return;
    if (isPlaying) ytPlayerRef.current.pauseVideo();
    else ytPlayerRef.current.playVideo();
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (!ytPlayerRef.current) return;
    if (isMuted) {
      ytPlayerRef.current.unMute();
      ytPlayerRef.current.setVolume(volume);
    } else ytPlayerRef.current.mute();
    setIsMuted(!isMuted);
  }, [isMuted, volume]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVol = parseInt(e.target.value);
      setVolume(newVol);
      if (ytPlayerRef.current) {
        ytPlayerRef.current.setVolume(newVol);
        if (newVol === 0) setIsMuted(true);
        else if (isMuted) {
          ytPlayerRef.current.unMute();
          setIsMuted(false);
        }
      }
    },
    [isMuted],
  );

  const handleProgressChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newProgress = parseFloat(e.target.value);
    setProgress(newProgress);
    if (ytPlayerRef.current && ytPlayerRef.current.getDuration) {
      const total = ytPlayerRef.current.getDuration();
      ytPlayerRef.current.seekTo((newProgress / 100) * total, true);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!playerRef.current) return;
    if (isTv) {
      // Chromium 69 may only expose the prefixed fullscreen API.
      const doc = document as Document & {
        webkitFullscreenElement?: Element;
        webkitExitFullscreen?: () => void;
      };
      const element = playerRef.current as HTMLDivElement & {
        webkitRequestFullscreen?: () => void;
      };
      try {
        const result =
          doc.fullscreenElement || doc.webkitFullscreenElement
            ? (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc)
            : (element.requestFullscreen || element.webkitRequestFullscreen)?.call(element);
        // Some TV browser shells disallow fullscreen. Keep controls usable.
        if (result) result.catch(() => {});
      } catch (_) {
        /* The TV shell can reject fullscreen even following remote input. */
      }
      return;
    }
    if (!document.fullscreenElement) {
      playerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, [isTv]);

  const skip = useCallback((seconds: number) => {
    if (!ytPlayerRef.current) return;
    const current = ytPlayerRef.current.getCurrentTime();
    ytPlayerRef.current.seekTo(current + seconds, true);
  }, []);

  const changeSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.setPlaybackRate(speed);
      } catch (_) {
        /* Optional provider APIs may be unavailable. */
      }
    }
    setShowSettings(false);
  }, []);

  const toggleSubtitle = useCallback((lang: string | null) => {
    if (!ytPlayerRef.current) return;
    if (lang === null) {
      setActiveSubtitle(null);
      try {
        ytPlayerRef.current.unloadModule("captions");
        ytPlayerRef.current.unloadModule("cc");
      } catch (_) {
        /* Optional provider APIs may be unavailable. */
      }
      try {
        ytPlayerRef.current.setOption("captions", "track", {});
      } catch (_) {
        /* Optional provider APIs may be unavailable. */
      }
    } else {
      setActiveSubtitle(lang);
      try {
        ytPlayerRef.current.loadModule("captions");
      } catch (_) {
        /* Optional provider APIs may be unavailable. */
      }
      setTimeout(() => {
        try {
          ytPlayerRef.current!.setOption("captions", "track", { languageCode: lang });
          ytPlayerRef.current!.setOption("captions", "fontSize", 1);
        } catch (_) {
          /* Optional provider APIs may be unavailable. */
        }
      }, 300);
    }
    setShowSubtitlesMenu(false);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node))
        setShowSettings(false);
      if (subtitlesRef.current && !subtitlesRef.current.contains(e.target as Node))
        setShowSubtitlesMenu(false);
      if (queueRef.current && !queueRef.current.contains(e.target as Node)) setShowQueue(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Controls auto-hide
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (isTv) {
      // Pointer movement reveals the TV controls and restarts the timer.
      touchTvControls();
      return;
    }
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettings && !showSubtitlesMenu) setShowControls(false);
    }, 3000);
  }, [isPlaying, showSettings, showSubtitlesMenu, isTv, touchTvControls]);

  // Desktop keeps its shortcuts. TV custom buttons use spatial navigation;
  // horizontal arrows on range inputs retain their native seek/volume action.
  useEffect(() => {
    if (isTv || useSimpleEmbed) return;
    document.body.setAttribute("data-tv-player-open", "1");
    return () => {
      document.body.removeAttribute("data-tv-player-open");
    };
  }, [useSimpleEmbed, isTv]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTv) {
        // Do not seek/change volume while the spatial navigator moves focus.
        if (e.key.indexOf("Arrow") === 0 || useSimpleEmbed) return;
        if (e.keyCode === 415 || e.key === "MediaPlay") {
          e.preventDefault();
          ytPlayerRef.current?.playVideo();
          return;
        }
        if (e.keyCode === 19 || e.key === "MediaPause") {
          e.preventDefault();
          ytPlayerRef.current?.pauseVideo();
          return;
        }
      }
      // TV remote media keys (Tizen keyCodes: play 415, pause 19, stop 413,
      // FF 417, RW 412) drive playback just like desktop shortcuts.
      if (
        e.keyCode === 415 ||
        e.keyCode === 19 ||
        e.key === "MediaPlayPause" ||
        e.key === "MediaPlay" ||
        e.key === "MediaPause"
      ) {
        e.preventDefault();
        if (!useSimpleEmbed) togglePlay();
        return;
      }
      if (e.keyCode === 417 || e.key === "MediaFastForward") {
        e.preventDefault();
        if (!useSimpleEmbed) skip(30);
        return;
      }
      if (e.keyCode === 412 || e.key === "MediaRewind") {
        e.preventDefault();
        if (!useSimpleEmbed) skip(-30);
        return;
      }
      if (e.keyCode === 413 || e.key === "MediaStop") {
        e.preventDefault();
        if (!useSimpleEmbed && ytPlayerRef.current) ytPlayerRef.current.pauseVideo?.();
        return;
      }
      if (showSettings || showSubtitlesMenu) {
        if (e.key === "Escape") {
          setShowSettings(false);
          setShowSubtitlesMenu(false);
        }
        return;
      }
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "t":
          setIsTheater((t) => !t);
          break;
        case "Escape":
          if (document.fullscreenElement) {
            document.exitFullscreen();
            setIsFullscreen(false);
          } else onClose();
          break;
        case "ArrowLeft":
          skip(-10);
          break;
        case "ArrowRight":
          skip(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((v) => {
            const n = Math.min(100, v + 10);
            if (ytPlayerRef.current) ytPlayerRef.current.setVolume(n);
            return n;
          });
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((v) => {
            const n = Math.max(0, v - 10);
            if (ytPlayerRef.current) ytPlayerRef.current.setVolume(n);
            return n;
          });
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    togglePlay,
    toggleMute,
    toggleFullscreen,
    onClose,
    skip,
    showSettings,
    showSubtitlesMenu,
    useSimpleEmbed,
    isTv,
  ]);

  // Fullscreen listener
  useEffect(() => {
    const h = () =>
      setIsFullscreen(
        !!(
          document.fullscreenElement ||
          (isTv &&
            (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement)
        ),
      );
    document.addEventListener("fullscreenchange", h);
    if (isTv) document.addEventListener("webkitfullscreenchange", h);
    return () => {
      document.removeEventListener("fullscreenchange", h);
      if (isTv) document.removeEventListener("webkitfullscreenchange", h);
    };
  }, [isTv]);

  const getSpeedLabel = (s: number) => (s === 1 ? "Normal" : `${s}x`);

  // TV embed: native YouTube controls (the TV remote can drive them) plus
  // `origin` — several Smart TV engines refuse the embed (Error 153) when
  // the origin/referrer of the embedding page is missing. The iframe also
  // sends a proper referrer via referrerPolicy below.
  const tvEmbedSrc = `${
    tvStage === 1 ? "https://www.youtube-nocookie.com" : "https://www.youtube.com"
  }/embed/${encodeURIComponent(videoId)}?autoplay=${autoPlay ? 1 : 0}&controls=1&rel=0&modestbranding=1&iv_load_policy=3&fs=1&playsinline=1&enablejsapi=0&origin=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.origin : "",
  )}`;

  // TV auto-hide is only ever active for the custom (API) player.
  const tvHidden = isTv && !useSimpleEmbed && tvControlsHidden;

  return (
    <div
      data-tv-player-scope={isTv ? "" : undefined}
      className={`${isTv ? "tv-custom-player " : ""}fixed inset-0 z-[100] bg-black animate-fadeIn flex items-center justify-center`}
    >
      <div
        ref={playerRef}
        tabIndex={isTv ? -1 : undefined}
        data-tv-focus-park={isTv ? "" : undefined}
        className={`relative bg-black transition-all duration-300 ${
          isTheater
            ? "w-full" + (isFullscreen ? " h-full" : " max-w-[95vw] aspect-video")
            : "w-full h-full"
        }`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          if (!isTv && isPlaying && !showSettings && !showSubtitlesMenu) setShowControls(false);
        }}
      >
        {/* Custom API mode hides the native bar, not every provider overlay.
            The edge crop below trims YouTube's edge overlays — and some of the
            video frame — but cross-origin title/logo/watermark/loading/end-
            screen elements are provider-owned and cannot be removed for sure.
            The plain embed is only an emergency fallback and is never cropped. */}
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          {useSimpleEmbed ? (
            <iframe
              key={`tv-embed-${tvStage}-${videoId}`}
              src={tvEmbedSrc}
              className="w-full h-full border-0"
              title="Video player"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="w-full h-full relative" style={{ overflow: "hidden" }}>
              <div
                className="absolute"
                style={{ top: "-60px", bottom: "-60px", left: "-2px", right: "-2px" }}
              >
                <div
                  ref={containerRef}
                  aria-hidden={isTv ? true : undefined}
                  className="w-full h-full"
                />
              </div>
            </div>
          )}
        </div>

        {/* Top gradient */}
        <div
          data-tv-autohide={tvHidden ? "hidden" : undefined}
          className={`absolute top-0 left-0 right-0 h-28 z-20 pointer-events-none transition-opacity duration-300 ${tvHidden ? "opacity-0" : ""}`}
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
          }}
        />
        {/* Bottom gradient */}
        <div
          data-tv-autohide={tvHidden ? "hidden" : undefined}
          className={`absolute bottom-0 left-0 right-0 h-36 z-20 pointer-events-none transition-opacity duration-300 ${tvHidden ? "opacity-0" : ""}`}
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 40%, transparent 100%)",
          }}
        />
        {/* Branding */}
        <div
          data-tv-autohide={tvHidden ? "hidden" : undefined}
          className="absolute bottom-2 right-2 z-10 opacity-20 text-[8px] text-white/30 pointer-events-none"
        >
          via YouTube
        </div>

        {/* Buffering */}
        {isBuffering && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="w-16 h-16 border-4 border-netflix-red/30 border-t-netflix-red rounded-full animate-spin" />
          </div>
        )}

        {useSimpleEmbed && (
          <button
            onClick={onClose}
            className="absolute top-4 left-4 z-40 w-10 h-10 rounded-full bg-black/70 flex items-center justify-center"
            aria-label="Close video"
          >
            <X size={22} className="text-white" />
          </button>
        )}

        {/* TV recovery bar: reachable with the D-pad, does not block playback. */}
        {useSimpleEmbed && showTvFallback && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-black/85 ring-1 ring-white/20 rounded-xl px-4 py-3">
            <span className="text-white/80 text-xs md:text-sm whitespace-nowrap">Not playing?</span>
            {tvStage === 0 ? (
              <button
                onClick={() => setTvStage(1)}
                className="h-9 px-4 rounded-full bg-white text-black text-xs font-bold whitespace-nowrap"
              >
                Switch player
              </button>
            ) : (
              <button
                onClick={() => {
                  setTvStage(0);
                  setShowTvFallback(false);
                }}
                className="h-9 px-4 rounded-full bg-white text-black text-xs font-bold whitespace-nowrap"
              >
                Retry player
              </button>
            )}
            <a
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
              className="h-9 px-4 rounded-full bg-white/15 ring-1 ring-white/25 text-white text-xs font-bold flex items-center whitespace-nowrap"
            >
              Open on YouTube
            </a>
            <button
              onClick={() => setShowTvFallback(false)}
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/70"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Click area */}
        <div
          className={`absolute inset-0 ${useSimpleEmbed ? "pointer-events-none" : "cursor-pointer"}`}
          style={{ zIndex: 25 }}
          onClick={(e) => {
            if (
              settingsRef.current?.contains(e.target as Node) ||
              subtitlesRef.current?.contains(e.target as Node)
            )
              return;
            setShowSettings(false);
            setShowSubtitlesMenu(false);
            togglePlay();
          }}
          onDoubleClick={toggleFullscreen}
        />

        {/* Controls overlay */}
        <div
          data-tv-autohide={tvHidden ? "hidden" : undefined}
          aria-hidden={tvHidden ? true : undefined}
          className={`${useSimpleEmbed ? "hidden" : "absolute inset-0 z-30 pointer-events-none transition-opacity duration-300"} ${
            isTv
              ? tvControlsHidden
                ? "opacity-0"
                : "opacity-100"
              : showControls
                ? "opacity-100"
                : "opacity-0"
          }`}
        >
          {/* ═══════ TOP BAR ═══════ */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 md:p-6 pointer-events-auto">
            <button
              onClick={onClose}
              aria-label={isTv ? "Close video" : undefined}
              className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center transition-all backdrop-blur-sm"
            >
              <X size={22} className="text-white" />
            </button>

            <div className="text-center flex-1 mx-4" />

            <div className="flex items-center gap-2">
              {/* ═══ SAVE TO WATCH LATER ═══ */}
              {onSaveToWatchLater && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSaveToWatchLater(videoId, videoTitle || "Video");
                  }}
                  className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center transition-all backdrop-blur-sm"
                  title="Save to Watch Later"
                >
                  <Bookmark size={18} className="text-white" />
                </button>
              )}

              {/* ═══ ADD TO PLAYLIST ═══ */}
              {onSaveToPlaylist && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSaveToPlaylist(videoId, videoTitle || "Video");
                  }}
                  className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center transition-all backdrop-blur-sm"
                  title="Add to Playlist"
                >
                  <ListPlus size={18} className="text-white" />
                </button>
              )}

              {/* ═══ QUEUE BUTTON ═══ */}
              {queueItems && queueItems.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowQueue((q) => !q);
                    setShowSettings(false);
                    setShowSubtitlesMenu(false);
                  }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-sm ${showQueue ? "bg-netflix-red/80 hover:bg-netflix-red" : "bg-black/50 hover:bg-black/80"}`}
                  title="Queue"
                >
                  <ListVideo size={18} className="text-white" />
                </button>
              )}

              {/* ═══ SUBTITLES BUTTON ═══ */}
              <div ref={subtitlesRef} className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSubtitlesMenu(!showSubtitlesMenu);
                    setShowSettings(false);
                  }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-sm ${activeSubtitle ? "bg-netflix-red/80 hover:bg-netflix-red" : "bg-black/50 hover:bg-black/80"}`}
                  title="Subtitles / CC"
                >
                  <Subtitles size={18} className="text-white" />
                </button>

                {showSubtitlesMenu && (
                  <div
                    className="absolute top-12 right-0 w-64 bg-[#181818]/95 backdrop-blur-xl rounded-lg shadow-2xl border border-white/10 overflow-hidden animate-fadeIn"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-4 py-3 border-b border-white/10">
                      <h4 className="text-white text-sm font-bold flex items-center gap-2">
                        <Subtitles size={14} /> Subtitles / CC
                      </h4>
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                      <button
                        onClick={() => toggleSubtitle(null)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${!activeSubtitle ? "text-white bg-white/10" : "text-gray-300 hover:bg-white/5 hover:text-white"}`}
                      >
                        <span className="w-5 flex justify-center">
                          {!activeSubtitle && <Check size={14} className="text-netflix-red" />}
                        </span>
                        Off
                      </button>
                      {subtitleTracks.length > 0 ? (
                        subtitleTracks.map((track) => (
                          <button
                            key={track.lang}
                            onClick={() => toggleSubtitle(track.lang)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${activeSubtitle === track.lang ? "text-white bg-white/10" : "text-gray-300 hover:bg-white/5 hover:text-white"}`}
                          >
                            <span className="w-5 flex justify-center">
                              {activeSubtitle === track.lang && (
                                <Check size={14} className="text-netflix-red" />
                              )}
                            </span>
                            {track.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-4 text-center">
                          <p className="text-gray-400 text-xs">No subtitles available</p>
                          <p className="text-gray-500 text-[11px] mt-1">
                            This video doesn't have subtitle tracks
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ═══ SETTINGS BUTTON (Speed Only) ═══ */}
              <div ref={settingsRef} className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSettings(!showSettings);
                    setShowSubtitlesMenu(false);
                  }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-sm ${showSettings ? "bg-white/20 hover:bg-white/30" : "bg-black/50 hover:bg-black/80"}`}
                  title="Settings"
                >
                  <Settings
                    size={18}
                    className={`text-white transition-transform duration-300 ${showSettings ? "rotate-90" : ""}`}
                  />
                </button>

                {showSettings && (
                  <div
                    className="absolute top-12 right-0 w-56 bg-[#181818]/95 backdrop-blur-xl rounded-lg shadow-2xl border border-white/10 overflow-hidden animate-fadeIn"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-4 py-3 border-b border-white/10">
                      <h4 className="text-white text-sm font-bold flex items-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                        Playback Speed
                      </h4>
                    </div>
                    <div className="py-1">
                      {SPEED_OPTIONS.map((speed) => (
                        <button
                          key={speed}
                          onClick={() => changeSpeed(speed)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${playbackSpeed === speed ? "text-white bg-white/10" : "text-gray-300 hover:bg-white/5 hover:text-white"}`}
                        >
                          <span className="w-5 flex justify-center">
                            {playbackSpeed === speed && (
                              <Check size={14} className="text-netflix-red" />
                            )}
                          </span>
                          <span>{speed === 1 ? "Normal" : `${speed}x`}</span>
                          {speed === 1 && (
                            <span className="ml-auto text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">
                              Default
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Center play button */}
          {!isPlaying && !isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
              <button
                onClick={togglePlay}
                aria-label={isTv ? "Play" : undefined}
                className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-all active:scale-90 border border-white/20"
              >
                <Play size={36} fill="white" className="text-white ml-1" />
              </button>
            </div>
          )}

          {/* ═══════ BOTTOM CONTROLS ═══════ */}
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 pointer-events-auto">
            {/* Progress bar */}
            <div className={`${isTv ? "tv-player-progress " : ""}relative mb-3 group/progress`}>
              <div className="relative h-1 group-hover/progress:h-1.5 bg-white/20 rounded-full transition-all cursor-pointer">
                <div
                  className="absolute top-0 left-0 h-full bg-white/30 rounded-full"
                  style={{ width: `${Math.min(progress + 5, 100)}%` }}
                />
                <div
                  className="absolute top-0 left-0 h-full bg-netflix-red rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-netflix-red rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-lg"
                  style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
                />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                aria-label={isTv ? "Video progress" : undefined}
                step={isTv ? "1" : "0.1"}
                value={progress}
                onChange={handleProgressChange}
                className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between">
              {/* Left controls */}
              <div className="flex items-center gap-2 md:gap-3">
                <button
                  ref={playButtonRef}
                  onClick={togglePlay}
                  aria-label={isTv ? (isPlaying ? "Pause" : "Play") : undefined}
                  className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-transform"
                >
                  {isPlaying ? (
                    <Pause size={26} fill="white" className="text-white" />
                  ) : (
                    <Play size={26} fill="white" className="text-white ml-0.5" />
                  )}
                </button>

                {(onPrev || hasPrev) && (
                  <button
                    onClick={onPrev}
                    className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform"
                  >
                    <SkipBack size={20} className="text-white" />
                  </button>
                )}

                <button
                  aria-label={isTv ? "Seek backward 10 seconds" : undefined}
                  onClick={() => skip(-10)}
                  className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform relative"
                >
                  <SkipBack size={20} className="text-white" />
                  <span className="absolute -bottom-0.5 text-[8px] text-white font-bold">10</span>
                </button>

                <button
                  aria-label={isTv ? "Seek forward 10 seconds" : undefined}
                  onClick={() => skip(10)}
                  className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform relative"
                >
                  <SkipForward size={20} className="text-white" />
                  <span className="absolute -bottom-0.5 text-[8px] text-white font-bold">10</span>
                </button>

                {(onNext || hasNext) && (
                  <button
                    onClick={onNext}
                    className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform"
                  >
                    <SkipForward size={20} className="text-white" />
                  </button>
                )}

                {/* Volume */}
                <div
                  className="flex items-center gap-1 relative"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <button
                    aria-label={isTv ? (isMuted ? "Unmute" : "Mute") : undefined}
                    onClick={toggleMute}
                    className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform"
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX size={22} className="text-white" />
                    ) : (
                      <Volume2 size={22} className="text-white" />
                    )}
                  </button>
                  <div
                    className={`transition-all duration-200 ${isTv ? "overflow-visible" : "overflow-hidden"} ${isTv || showVolumeSlider ? "w-20 opacity-100" : "w-0 opacity-0"}`}
                  >
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={isMuted ? 0 : volume}
                      aria-label={isTv ? "Volume" : undefined}
                      onChange={handleVolumeChange}
                      className="volume-slider"
                    />
                  </div>
                </div>

                {/* Time */}
                <span className="text-white/80 text-xs md:text-sm font-medium ml-2">
                  {currentTime} / {duration}
                </span>

                {/* Speed badge */}
                {playbackSpeed !== 1 && (
                  <span className="text-netflix-red text-xs font-bold bg-netflix-red/10 px-2 py-0.5 rounded ml-1">
                    {getSpeedLabel(playbackSpeed)}
                  </span>
                )}
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-2 md:gap-3">
                {/* Theater Mode */}
                <button
                  onClick={() => setIsTheater((t) => !t)}
                  title="Theater Mode (T)"
                  className={`w-9 h-9 flex items-center justify-center hover:scale-110 transition-transform ${isTheater ? "text-netflix-red" : "text-white"}`}
                >
                  <LayoutTemplate size={20} />
                </button>

                <button
                  aria-label={isTv ? (isFullscreen ? "Exit fullscreen" : "Fullscreen") : undefined}
                  onClick={toggleFullscreen}
                  className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-transform"
                >
                  {isFullscreen ? (
                    <Minimize size={22} className="text-white" />
                  ) : (
                    <Maximize size={22} className="text-white" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════ QUEUE SIDEBAR PANEL — outside controls overlay, inside playerRef ═══════ */}
        {showQueue && queueItems && queueItems.length > 1 && (
          <div
            ref={queueRef}
            className="absolute top-0 right-0 bottom-0 w-80 bg-black/90 backdrop-blur-xl z-40 flex flex-col border-l border-white/10 animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <ListVideo size={15} className="text-netflix-red" />
                Queue
                <span className="text-white/40 font-normal ml-1">
                  {(currentQueueIndex ?? 0) + 1} / {queueItems.length}
                </span>
              </h3>
              <button
                onClick={() => setShowQueue(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={15} className="text-white/60" />
              </button>
            </div>

            {/* Scrollable video list */}
            <div className="overflow-y-auto flex-1 py-1">
              {queueItems.map((item, idx) => {
                const isCurrent = idx === currentQueueIndex;
                return (
                  <button
                    key={`${item.youtubeId}-${idx}`}
                    onClick={() => {
                      onJumpTo?.(idx);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      isCurrent
                        ? "bg-netflix-red/15 border-l-[3px] border-netflix-red"
                        : "hover:bg-white/5 border-l-[3px] border-transparent"
                    }`}
                  >
                    {/* Index / playing indicator */}
                    <span
                      className={`text-[11px] font-bold w-5 flex-shrink-0 text-center ${isCurrent ? "text-netflix-red" : "text-white/35"}`}
                    >
                      {isCurrent ? (
                        <Play size={11} className="mx-auto fill-netflix-red text-netflix-red" />
                      ) : (
                        idx + 1
                      )}
                    </span>

                    {/* Thumbnail */}
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className={`w-16 h-10 object-cover rounded flex-shrink-0 ${isCurrent ? "ring-1 ring-netflix-red" : ""}`}
                      />
                    ) : (
                      <div className="w-16 h-10 bg-white/10 rounded flex-shrink-0 flex items-center justify-center">
                        <Play size={14} className="text-white/30" />
                      </div>
                    )}

                    {/* Title */}
                    <p
                      className={`text-xs leading-snug line-clamp-2 flex-1 ${isCurrent ? "text-white font-semibold" : "text-white/60"}`}
                    >
                      {item.title || item.youtubeId}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
