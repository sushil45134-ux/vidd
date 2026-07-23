import { useEffect, useState } from "react";
import { Play, Info, Upload, RefreshCw, Eye, EyeOff } from "lucide-react";
import type { Movie } from "../data";
import { useSiteConfig, loadConfig, saveConfig } from "../lib/customization";
import Logo from "./Logo";

interface HeroBannerProps {
  movies: Movie[];
  onMoreInfo: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  onUploadClick?: () => void;
  onSyncClick?: () => void;
  isAdmin?: boolean;
}

export default function HeroBanner({
  movies,
  onMoreInfo,
  onPlay,
  onUploadClick,
  onSyncClick,
  isAdmin,
}: HeroBannerProps) {
  const [index, setIndex] = useState(0);
  const cfg = useSiteConfig();
  const overlayVisible = cfg.heroOverlayVisible !== false;

  const toggleOverlay = () => {
    const current = loadConfig();
    saveConfig({ ...current, heroOverlayVisible: !(current.heroOverlayVisible !== false) });
  };

  useEffect(() => {
    if (movies.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % movies.length), 8000);
    return () => clearInterval(t);
  }, [movies.length]);

  // Empty state — no videos yet
  if (movies.length === 0) {
    return (
      <div className="tv-hero relative w-full h-[calc(100vh-4rem)] min-h-[520px] overflow-hidden flex items-center justify-center">
        <div className="tv-hero-bg absolute inset-0">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-[#ff6a00]/10 rounded-full blur-[180px]" />
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black to-transparent" />
        </div>
        <div className="relative z-10 text-center px-6 max-w-2xl animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#ff6a00] to-[#ee0979] flex items-center justify-center shadow-2xl shadow-[#ee0979]/30">
            <Play size={36} fill="white" className="ml-1" />
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4 flex items-center justify-center gap-2">
            Welcome to <Logo size="lg" />
          </h1>
          <p className="text-white/50 text-sm md:text-base mb-8 max-w-lg mx-auto">
            {isAdmin
              ? "Get started by uploading a video or syncing a YouTube playlist."
              : "No videos yet. Ask the admin to add content."}
          </p>
          {isAdmin && (
            <div className="flex items-center gap-3 justify-center flex-wrap">
              {onUploadClick && (
                <button
                  onClick={onUploadClick}
                  className="h-11 px-5 rounded-full bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white text-sm font-bold flex items-center gap-2 shadow-lg shadow-[#ee0979]/20 transition active:scale-95"
                >
                  <Upload size={15} />
                  Upload video
                </button>
              )}
              {onSyncClick && (
                <button
                  onClick={onSyncClick}
                  className="h-11 px-5 rounded-full bg-white/10 hover:bg-white/15 ring-1 ring-white/10 text-white text-sm font-bold flex items-center gap-2 transition active:scale-95"
                >
                  <RefreshCw size={14} />
                  Sync playlist
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const item = movies[index % movies.length];
  const title = cfg.heroTitle?.trim() || item.title;
  const description = cfg.heroDescription?.trim() || item.description;

  return (
    <div className="tv-hero relative w-full h-[calc(100vh-4rem)] min-h-[520px] overflow-hidden">
      <div className="tv-hero-bg absolute inset-0" key={item.id}>
        <div
          className="absolute inset-0 bg-cover bg-center animate-fade-in bg-slate-900"
          style={{ backgroundImage: `url(${item.backdrop || item.image || item.thumbnailUrl || ""})` }}
        />
        {overlayVisible && (
          <>
            <div className="absolute inset-0 bg-black/40 bg-gradient-to-r from-black/40 via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/70 to-transparent" />
          </>
        )}
        {!overlayVisible && (
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />
        )}
      </div>

      {isAdmin && (
        <button
          onClick={toggleOverlay}
          title={overlayVisible ? "Hide banner text" : "Show banner text"}
           className="absolute top-24 right-4 md:right-8 z-20 h-10 px-3 rounded-full bg-black/80 hover:bg-black ring-1 ring-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition"
        >
          {overlayVisible ? <EyeOff size={14} /> : <Eye size={14} />}
          {overlayVisible ? "Hide text" : "Show text"}
        </button>
      )}

      {overlayVisible && (
      <div className="relative z-10 h-full flex items-end pb-28 md:pb-36 px-4 md:px-12 max-w-[1800px] mx-auto">
        <div className="max-w-2xl animate-fade-in" key={`c-${item.id}`}>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="px-2 py-0.5 bg-[#ff6a00] text-black text-[10px] font-black rounded tracking-wider">
              {cfg.heroBadge}
            </span>
            {item.rating && (
             <span className="px-2 py-0.5 bg-black/70 text-white text-[10px] font-bold rounded">
                {item.rating}
              </span>
            )}
            {item.year ? <span className="text-white/60 text-xs">{item.year}</span> : null}
            {item.match ? (
              <span className="text-green-400 text-xs font-bold">{item.match}% Match</span>
            ) : null}
          </div>

          <h1 className="text-xl md:text-2xl lg:text-3xl font-black text-white leading-[1.05] mb-4 tracking-tight">
            {title}
          </h1>

          <p className="text-sm md:text-base text-white/70 leading-relaxed mb-6 line-clamp-3 max-w-xl">
            {description}
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => onPlay(item)}
              className="h-11 md:h-12 px-6 md:px-7 rounded-md bg-white hover:bg-white/90 text-black font-bold text-sm flex items-center gap-2.5 shadow-xl transition active:scale-95"
            >
              <Play size={18} fill="black" />
              Play
            </button>
            <button
              onClick={() => onMoreInfo(item)}
               className="h-11 md:h-12 px-6 md:px-7 rounded-md bg-black/80 hover:bg-black text-white font-bold text-sm flex items-center gap-2.5 transition active:scale-95"
            >
              <Info size={18} />
              More Info
            </button>
          </div>

          {movies.length > 1 && (
            <div className="flex items-center gap-2 mt-6">
              {movies.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  className={`h-1 rounded-full transition-all ${
                    i === index ? "w-8 bg-[#ff6a00]" : "w-3 bg-white/30 hover:bg-white/50"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
