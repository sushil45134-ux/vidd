import { memo, useEffect, useState } from "react";
import { Play } from "lucide-react";
import type { Movie } from "../data";
import { movieImageSources } from "../lib/media";
import { useIsTvBrowser } from "../hooks/useIsTvBrowser";
import SmartImage from "./SmartImage";

interface SectionHeroProps {
  /** Resolved banner movies for this section (admin picks, else top titles). */
  movies: Movie[];
  onMoreInfo: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  /** Library fetch still in flight — show a skeleton, not nothing. */
  loading?: boolean;
}

/**
 * Contained page banner for the Movies / Anime / Cartoon tabs — a rounded
 * wide box inside the page padding (NOT a full-screen hero). Same admin
 * banner system as home: "Set Banner" on any title, then pick the page.
 */
function SectionHero({ movies, onMoreInfo, onPlay, loading = false }: SectionHeroProps) {
  const IS_TV = useIsTvBrowser();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (movies.length <= 1) return;
    // Same rule as the home hero: TVs switch banners by dots only, so the
    // weak compositor never swaps a big image mid-scroll.
    if (IS_TV) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % movies.length), 8000);
    return () => clearInterval(t);
    // IS_TV is false until hydration completes, so the auto-rotate interval
    // must be torn down when a TV is detected.
  }, [movies.length, IS_TV]);

  if (movies.length === 0 && loading) {
    return (
      <div className="px-4 md:px-12 mb-8">
        <div className="relative h-[220px] md:h-[320px] rounded-2xl overflow-hidden bg-white/5 animate-pulse ring-1 ring-white/10">
          <div className="absolute bottom-6 left-6 md:left-10 right-6">
            <div className="h-7 md:h-9 w-2/3 max-w-md rounded bg-white/10 mb-3" />
            <div className="h-3 w-1/2 max-w-sm rounded bg-white/10 mb-5" />
            <div className="h-10 w-36 rounded-full bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (movies.length === 0) return null;

  const item = movies[index % movies.length];
  // One URL list for both layers (browser downloads it once, shows it twice).
  const heroSources = movieImageSources(item, "hero");

  return (
    <div className="px-4 md:px-12 mb-8">
      <div
        className="relative h-[220px] md:h-[320px] rounded-2xl overflow-hidden ring-1 ring-white/10 bg-[#101014] cursor-pointer group"
        onClick={() => onMoreInfo(item)}
        tabIndex={0}
        role="button"
        aria-label={`${item.title} — open details`}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            onMoreInfo(item);
          }
        }}
      >
        <div className="absolute inset-0" key={item.id}>
          {/* Blurred full-bleed fill behind the photo, so the wide box never
              shows empty bands. Desktop/phone only — TVs keep the solid box
              background to spare the weak compositor a big blur raster. */}
          {!IS_TV && (
            <SmartImage
              src={heroSources}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-70"
            />
          )}
          {/* The FULL picture, never cropped — Google-sized landscape photos
              (like the Suzume poster) show edge to edge in the same box. */}
          <SmartImage
            src={heroSources}
            alt={item.title}
            fetchPriority="high"
            loading="eager"
            decoding="async"
            className="absolute inset-0 w-full h-full object-contain animate-fade-in"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 to-transparent" />
        </div>

        <div
          className="absolute left-6 md:left-10 bottom-6 md:bottom-8 right-6 max-w-xl animate-fade-in"
          key={`c-${item.id}`}
        >
          <h1 className="text-2xl md:text-4xl font-black text-white leading-tight tracking-tight mb-2">
            {item.title}
          </h1>
          {item.description && (
            <p className="text-white/70 text-xs md:text-sm leading-relaxed mb-4 line-clamp-2">
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(item);
              }}
              className="h-10 md:h-11 px-6 rounded-full bg-white hover:bg-white/90 text-black font-bold text-sm flex items-center gap-2 shadow-xl transition active:scale-95"
            >
              <Play size={16} fill="black" />
              Watch Now
            </button>
          </div>
        </div>

        {movies.length > 1 && (
          <div className="absolute bottom-6 md:bottom-8 right-6 md:right-10 flex items-center gap-2">
            {movies.map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setIndex(i);
                }}
                aria-label={`Show banner ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index % movies.length
                    ? "w-7 bg-[#ff6a00]"
                    : "w-2.5 bg-white/30 hover:bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SectionHero);
