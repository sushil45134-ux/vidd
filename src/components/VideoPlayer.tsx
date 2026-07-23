import { useState, useRef, useEffect, useCallback } from "react";
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
  const [isPlaying, setIsPlaying] = useState(true);
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

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Subtitles state
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);

  const playerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ytPlayerRef = useRef<any>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const settingsRef = useRef<HTMLDivElement>(null);
  const subtitlesRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);

  // Initialize YouTube Player API
  useEffect(() => {
    hasStartedRef.current = false;
    setVideoTitle("");
    setIsBuffering(true);
    setProgress(0);
    setCurrentTime("0:00");
    setDuration("0:00");

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    const initPlayer = () => {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === "function") {
        ytPlayerRef.current.loadVideoById(videoId);
        if (autoPlay) ytPlayerRef.current.playVideo();
        return;
      }
      const player = new (window as any).YT.Player("yt-player", {
        videoId,
        playerVars: {
          autoplay: autoPlay ? 1 : 0,
          controls: 0,
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
          onReady: (event: any) => {
            const p = event.target;
            ytPlayerRef.current = p;
            p.setVolume(volume);
            if (autoPlay) p.playVideo();
            setIsBuffering(false);

            try {
              const title = p.getVideoData && p.getVideoData()?.title;
              if (title) setVideoTitle(title);
            } catch (_) {}

            try { p.unloadModule("captions"); p.unloadModule("cc"); } catch (_) {}
            try { p.setOption("captions", "track", {}); p.setOption("cc", "track", {}); } catch (_) {}

            setTimeout(() => {
              try {
                const tracks = p.getOption("captions", "tracklist");
                if (tracks && tracks.length > 0) {
                  const parsed: SubtitleTrack[] = tracks.map((t: any) => ({
                    lang: t.languageCode || t.vss_id || "unknown",
                    name: t.languageName || t.displayName || t.languageCode || "Unknown",
                  }));
                  setSubtitleTracks(parsed);
                }
              } catch (_) {}
            }, 2000);

            progressIntervalRef.current = setInterval(() => {
              const inst = ytPlayerRef.current;
              if (inst && typeof inst.getCurrentTime === "function" && typeof inst.getDuration === "function") {
                try {
                  const current = inst.getCurrentTime();
                  const total = inst.getDuration();
                  if (total > 0) {
                    setProgress((current / total) * 100);
                    setCurrentTime(formatTime(current));
                    setDuration(formatTime(total));
                  }
                } catch (_) {}
              }
            }, 500);
          },
          onStateChange: (event: any) => {
            const YT = (window as any).YT;
            const p = event.target;

            if (!activeSubtitle) {
              try { p.unloadModule && p.unloadModule("captions"); p.unloadModule && p.unloadModule("cc"); } catch (_) {}
              try { p.setOption && p.setOption("captions", "track", {}); } catch (_) {}
            }

            if (event.data === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              setIsBuffering(false);
              let title = "Now Playing";
              try { title = (p.getVideoData && p.getVideoData()?.title) || "Now Playing"; } catch (_) {}
              setVideoTitle(title);
              if (!hasStartedRef.current) {
                hasStartedRef.current = true;
                onPlayStart?.(videoId, title);
              }
            } else if (event.data === YT.PlayerState.PAUSED) {
              setIsPlaying(false);
            } else if (event.data === YT.PlayerState.BUFFERING) {
              setIsBuffering(true);
            } else if (event.data === YT.PlayerState.ENDED) {
              setIsPlaying(false);
              setProgress(100);
              if (onNext) onNext();
            }
          },
        },
      });
      ytPlayerRef.current = player;
    };

    if ((window as any).YT && (window as any).YT.Player) {
      initPlayer();
    } else {
      (window as any).onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      const inst = ytPlayerRef.current;
      ytPlayerRef.current = null;
      if (inst && typeof inst.destroy === "function") {
        try { inst.destroy(); } catch (_) {}
      }
    };
  }, [videoId]);

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const togglePlay = useCallback(() => {
    if (!ytPlayerRef.current) return;
    if (isPlaying) ytPlayerRef.current.pauseVideo();
    else ytPlayerRef.current.playVideo();
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (!ytPlayerRef.current) return;
    if (isMuted) { ytPlayerRef.current.unMute(); ytPlayerRef.current.setVolume(volume); }
    else ytPlayerRef.current.mute();
    setIsMuted(!isMuted);
  }, [isMuted, volume]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseInt(e.target.value);
    setVolume(newVol);
    if (ytPlayerRef.current) {
      ytPlayerRef.current.setVolume(newVol);
      if (newVol === 0) setIsMuted(true);
      else if (isMuted) { ytPlayerRef.current.unMute(); setIsMuted(false); }
    }
  }, [isMuted]);

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
    if (!document.fullscreenElement) { playerRef.current.requestFullscreen(); setIsFullscreen(true); }
    else { document.exitFullscreen(); setIsFullscreen(false); }
  }, []);

  const skip = useCallback((seconds: number) => {
    if (!ytPlayerRef.current) return;
    const current = ytPlayerRef.current.getCurrentTime();
    ytPlayerRef.current.seekTo(current + seconds, true);
  }, []);

  const changeSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.setPlaybackRate(speed); } catch (_) {}
    }
    setShowSettings(false);
  }, []);

  const toggleSubtitle = useCallback((lang: string | null) => {
    if (!ytPlayerRef.current) return;
    if (lang === null) {
      setActiveSubtitle(null);
      try { ytPlayerRef.current.unloadModule("captions"); ytPlayerRef.current.unloadModule("cc"); } catch (_) {}
      try { ytPlayerRef.current.setOption("captions", "track", {}); } catch (_) {}
    } else {
      setActiveSubtitle(lang);
      try { ytPlayerRef.current.loadModule("captions"); } catch (_) {}
      setTimeout(() => {
        try {
          ytPlayerRef.current.setOption("captions", "track", { languageCode: lang });
          ytPlayerRef.current.setOption("captions", "fontSize", 1);
        } catch (_) {}
      }, 300);
    }
    setShowSubtitlesMenu(false);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false);
      if (subtitlesRef.current && !subtitlesRef.current.contains(e.target as Node)) setShowSubtitlesMenu(false);
      if (queueRef.current && !queueRef.current.contains(e.target as Node)) setShowQueue(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Controls auto-hide
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettings && !showSubtitlesMenu) setShowControls(false);
    }, 3000);
  }, [isPlaying, showSettings, showSubtitlesMenu]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showSettings || showSubtitlesMenu) {
        if (e.key === "Escape") { setShowSettings(false); setShowSubtitlesMenu(false); }
        return;
      }
      switch (e.key) {
        case " ": case "k": e.preventDefault(); togglePlay(); break;
        case "m": toggleMute(); break;
        case "f": toggleFullscreen(); break;
        case "t": setIsTheater(t => !t); break;
        case "Escape":
          if (document.fullscreenElement) { document.exitFullscreen(); setIsFullscreen(false); }
          else onClose();
          break;
        case "ArrowLeft": skip(-10); break;
        case "ArrowRight": skip(10); break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((v) => { const n = Math.min(100, v + 10); if (ytPlayerRef.current) ytPlayerRef.current.setVolume(n); return n; });
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((v) => { const n = Math.max(0, v - 10); if (ytPlayerRef.current) ytPlayerRef.current.setVolume(n); return n; });
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, toggleMute, toggleFullscreen, onClose, skip, showSettings, showSubtitlesMenu]);

  // Fullscreen listener
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  const getSpeedLabel = (s: number) => (s === 1 ? "Normal" : `${s}x`);

  return (
    <div className="fixed inset-0 z-[100] bg-black animate-fadeIn flex items-center justify-center">
      <div
        ref={playerRef}
        className={`relative bg-black transition-all duration-300 ${
          isTheater
            ? "w-full" + (isFullscreen ? " h-full" : " max-w-[95vw] aspect-video")
            : "w-full h-full"
        }`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { if (isPlaying && !showSettings && !showSubtitlesMenu) setShowControls(false); }}
      >
        {/* YouTube Player */}
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <div className="w-full h-full relative" style={{ overflow: "hidden" }}>
            <div className="absolute" style={{ top: "-60px", bottom: "-60px", left: "-2px", right: "-2px" }}>
              <div id="yt-player" className="w-full h-full" />
            </div>
          </div>
        </div>

        {/* Top gradient */}
        <div className="absolute top-0 left-0 right-0 h-28 z-20 pointer-events-none" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)" }} />
        {/* Bottom gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-36 z-20 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 40%, transparent 100%)" }} />
        {/* Branding */}
        <div className="absolute bottom-2 right-2 z-10 opacity-20 text-[8px] text-white/30 pointer-events-none">via YouTube</div>

        {/* Buffering */}
        {isBuffering && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="w-16 h-16 border-4 border-netflix-red/30 border-t-netflix-red rounded-full animate-spin" />
          </div>
        )}

        {/* Click area */}
        <div
          className="absolute inset-0 cursor-pointer"
          style={{ zIndex: 25 }}
          onClick={(e) => {
            if (settingsRef.current?.contains(e.target as Node) || subtitlesRef.current?.contains(e.target as Node)) return;
            setShowSettings(false); setShowSubtitlesMenu(false); togglePlay();
          }}
          onDoubleClick={toggleFullscreen}
        />

        {/* Controls overlay */}
        <div className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0"}`}>

          {/* ═══════ TOP BAR ═══════ */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 md:p-6 pointer-events-auto">
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center transition-all backdrop-blur-sm">
              <X size={22} className="text-white" />
            </button>

            <div className="text-center flex-1 mx-4" />


            <div className="flex items-center gap-2">

              {/* ═══ SAVE TO WATCH LATER ═══ */}
              {onSaveToWatchLater && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSaveToWatchLater(videoId, videoTitle || "Video"); }}
                  className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center transition-all backdrop-blur-sm"
                  title="Save to Watch Later"
                >
                  <Bookmark size={18} className="text-white" />
                </button>
              )}

              {/* ═══ ADD TO PLAYLIST ═══ */}
              {onSaveToPlaylist && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSaveToPlaylist(videoId, videoTitle || "Video"); }}
                  className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center transition-all backdrop-blur-sm"
                  title="Add to Playlist"
                >
                  <ListPlus size={18} className="text-white" />
                </button>
              )}

              {/* ═══ QUEUE BUTTON ═══ */}
              {queueItems && queueItems.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQueue(q => !q); setShowSettings(false); setShowSubtitlesMenu(false); }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-sm ${showQueue ? "bg-netflix-red/80 hover:bg-netflix-red" : "bg-black/50 hover:bg-black/80"}`}
                  title="Queue"
                >
                  <ListVideo size={18} className="text-white" />
                </button>
              )}

              {/* ═══ SUBTITLES BUTTON ═══ */}
              <div ref={subtitlesRef} className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubtitlesMenu(!showSubtitlesMenu); setShowSettings(false); }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-sm ${activeSubtitle ? "bg-netflix-red/80 hover:bg-netflix-red" : "bg-black/50 hover:bg-black/80"}`}
                  title="Subtitles / CC"
                >
                  <Subtitles size={18} className="text-white" />
                </button>

                {showSubtitlesMenu && (
                  <div className="absolute top-12 right-0 w-64 bg-[#181818]/95 backdrop-blur-xl rounded-lg shadow-2xl border border-white/10 overflow-hidden animate-fadeIn" onClick={(e) => e.stopPropagation()}>
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
                        <span className="w-5 flex justify-center">{!activeSubtitle && <Check size={14} className="text-netflix-red" />}</span>
                        Off
                      </button>
                      {subtitleTracks.length > 0 ? subtitleTracks.map((track) => (
                        <button
                          key={track.lang}
                          onClick={() => toggleSubtitle(track.lang)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${activeSubtitle === track.lang ? "text-white bg-white/10" : "text-gray-300 hover:bg-white/5 hover:text-white"}`}
                        >
                          <span className="w-5 flex justify-center">{activeSubtitle === track.lang && <Check size={14} className="text-netflix-red" />}</span>
                          {track.name}
                        </button>
                      )) : (
                        <div className="px-4 py-4 text-center">
                          <p className="text-gray-400 text-xs">No subtitles available</p>
                          <p className="text-gray-500 text-[11px] mt-1">This video doesn't have subtitle tracks</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ═══ SETTINGS BUTTON (Speed Only) ═══ */}
              <div ref={settingsRef} className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setShowSubtitlesMenu(false); }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-sm ${showSettings ? "bg-white/20 hover:bg-white/30" : "bg-black/50 hover:bg-black/80"}`}
                  title="Settings"
                >
                  <Settings size={18} className={`text-white transition-transform duration-300 ${showSettings ? "rotate-90" : ""}`} />
                </button>

                {showSettings && (
                  <div className="absolute top-12 right-0 w-56 bg-[#181818]/95 backdrop-blur-xl rounded-lg shadow-2xl border border-white/10 overflow-hidden animate-fadeIn" onClick={(e) => e.stopPropagation()}>
                    <div className="px-4 py-3 border-b border-white/10">
                      <h4 className="text-white text-sm font-bold flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
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
                            {playbackSpeed === speed && <Check size={14} className="text-netflix-red" />}
                          </span>
                          <span>{speed === 1 ? "Normal" : `${speed}x`}</span>
                          {speed === 1 && <span className="ml-auto text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">Default</span>}
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
              <button onClick={togglePlay} className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-all active:scale-90 border border-white/20">
                <Play size={36} fill="white" className="text-white ml-1" />
              </button>
            </div>
          )}

          {/* ═══════ BOTTOM CONTROLS ═══════ */}
          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 pointer-events-auto">
            {/* Progress bar */}
            <div className="relative mb-3 group/progress">
              <div className="relative h-1 group-hover/progress:h-1.5 bg-white/20 rounded-full transition-all cursor-pointer">
                <div className="absolute top-0 left-0 h-full bg-white/30 rounded-full" style={{ width: `${Math.min(progress + 5, 100)}%` }} />
                <div className="absolute top-0 left-0 h-full bg-netflix-red rounded-full transition-all" style={{ width: `${progress}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-netflix-red rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-lg" style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }} />
              </div>
              <input type="range" min="0" max="100" step="0.1" value={progress} onChange={handleProgressChange} className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer" />
            </div>

            <div className="flex items-center justify-between">
              {/* Left controls */}
              <div className="flex items-center gap-2 md:gap-3">
                <button onClick={togglePlay} className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-transform">
                  {isPlaying ? <Pause size={26} fill="white" className="text-white" /> : <Play size={26} fill="white" className="text-white ml-0.5" />}
                </button>

                {(onPrev || hasPrev) && (
                  <button onClick={onPrev} className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform">
                    <SkipBack size={20} className="text-white" />
                  </button>
                )}

                <button onClick={() => skip(-10)} className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform relative">
                  <SkipBack size={20} className="text-white" />
                  <span className="absolute -bottom-0.5 text-[8px] text-white font-bold">10</span>
                </button>

                <button onClick={() => skip(10)} className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform relative">
                  <SkipForward size={20} className="text-white" />
                  <span className="absolute -bottom-0.5 text-[8px] text-white font-bold">10</span>
                </button>

                {(onNext || hasNext) && (
                  <button onClick={onNext} className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform">
                    <SkipForward size={20} className="text-white" />
                  </button>
                )}

                {/* Volume */}
                <div className="flex items-center gap-1 relative" onMouseEnter={() => setShowVolumeSlider(true)} onMouseLeave={() => setShowVolumeSlider(false)}>
                  <button onClick={toggleMute} className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform">
                    {isMuted || volume === 0 ? <VolumeX size={22} className="text-white" /> : <Volume2 size={22} className="text-white" />}
                  </button>
                  <div className={`transition-all duration-200 overflow-hidden ${showVolumeSlider ? "w-20 opacity-100" : "w-0 opacity-0"}`}>
                    <input type="range" min="0" max="100" value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="volume-slider" />
                  </div>
                </div>

                {/* Time */}
                <span className="text-white/80 text-xs md:text-sm font-medium ml-2">{currentTime} / {duration}</span>

                {/* Speed badge */}
                {playbackSpeed !== 1 && (
                  <span className="text-netflix-red text-xs font-bold bg-netflix-red/10 px-2 py-0.5 rounded ml-1">{getSpeedLabel(playbackSpeed)}</span>
                )}
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-2 md:gap-3">
                {/* Theater Mode */}
                <button
                  onClick={() => setIsTheater(t => !t)}
                  title="Theater Mode (T)"
                  className={`w-9 h-9 flex items-center justify-center hover:scale-110 transition-transform ${isTheater ? "text-netflix-red" : "text-white"}`}
                >
                  <LayoutTemplate size={20} />
                </button>

                <button onClick={toggleFullscreen} className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-transform">
                  {isFullscreen ? <Minimize size={22} className="text-white" /> : <Maximize size={22} className="text-white" />}
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
                    onClick={() => { onJumpTo?.(idx); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      isCurrent
                        ? "bg-netflix-red/15 border-l-[3px] border-netflix-red"
                        : "hover:bg-white/5 border-l-[3px] border-transparent"
                    }`}
                  >
                    {/* Index / playing indicator */}
                    <span className={`text-[11px] font-bold w-5 flex-shrink-0 text-center ${isCurrent ? "text-netflix-red" : "text-white/35"}`}>
                      {isCurrent
                        ? <Play size={11} className="mx-auto fill-netflix-red text-netflix-red" />
                        : idx + 1}
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
                    <p className={`text-xs leading-snug line-clamp-2 flex-1 ${isCurrent ? "text-white font-semibold" : "text-white/60"}`}>
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
