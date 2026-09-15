import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Play, RotateCcw, X } from "lucide-react";
import type { Movie } from "../data";
import SmartImage from "./SmartImage";
import { movieImageSources } from "../lib/media";
import { useIsTvBrowser } from "../hooks/useIsTvBrowser";
import { episodeTag, formatTimeLeft, type ResumeItem } from "../lib/continueWatching";

interface ContinueWatchingRowProps {
  title?: string;
  items: ResumeItem[];
  onPlay: (movie: Movie, opts?: { fromStart?: boolean }) => void;
  onSelectMovie: (movie: Movie) => void;
  onRemove: (key: string) => void;
}

function ContinueWatchingRow({
  title = "Continue Watching",
  items,
  onPlay,
  onSelectMovie,
  onRemove,
}: ContinueWatchingRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  // Same desktop/TV split as MovieRow: smooth scroll on desktop, one
  // synchronous card-step on Tizen's slow compositor.
  const isTv = useIsTvBrowser();

  const scrollRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);
  const handleScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      if (rowRef.current) {
        const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
        setShowLeftArrow(scrollLeft > 20);
        setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 20);
      }
    });
  };

  const scroll = (direction: "left" | "right") => {
    const el = rowRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.8;
    if (!isTv) {
      el.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
      return;
    }
    const children = el.children;
    let pitch = 0;
    if (children.length >= 2) {
      const first = children[0] as HTMLElement;
      const second = children[1] as HTMLElement;
      pitch = second.offsetLeft - first.offsetLeft;
    }
    if (pitch <= 0 && children.length >= 1) {
      pitch = (children[0] as HTMLElement).offsetWidth || 0;
    }
    if (pitch <= 0) pitch = scrollAmount;
    const steps = Math.max(1, Math.round(scrollAmount / pitch));
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const target = el.scrollLeft + (direction === "left" ? -steps * pitch : steps * pitch);
    el.scrollLeft = Math.max(0, Math.min(max, Math.round(target)));
  };

  if (items.length === 0) return null;

  return (
    <div className="relative px-4 md:px-12 mb-8 group/row cv-row">
      {title && (
        <h2 className="text-white text-lg md:text-xl font-bold mb-2 hover:text-gray-300 cursor-pointer transition-colors">
          {title}
        </h2>
      )}

      <div className="relative -mx-1">
        {showLeftArrow && (
          <button
            onClick={() => scroll("left")}
            aria-label="Scroll row left"
            className={`absolute left-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all rounded-r ${
              isTv ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
            }`}
          >
            <ChevronLeft size={36} className="text-white" />
          </button>
        )}

        <div
          ref={rowRef}
          onScroll={handleScroll}
          className={`flex gap-2.5 overflow-x-scroll scrollbar-hide ${
            isTv ? "" : "scroll-smooth"
          } py-4 px-1`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {items.map((item) => (
            <ResumeCard
              key={item.key}
              item={item}
              onPlay={onPlay}
              onSelectMovie={onSelectMovie}
              onRemove={onRemove}
            />
          ))}
        </div>

        {showRightArrow && (
          <button
            onClick={() => scroll("right")}
            aria-label="Scroll row right"
            className={`absolute right-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all rounded-l ${
              isTv ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
            }`}
          >
            <ChevronRight size={36} className="text-white" />
          </button>
        )}
      </div>
    </div>
  );
}

function ResumeCard({
  item,
  onPlay,
  onSelectMovie,
  onRemove,
}: {
  item: ResumeItem;
  onPlay: (movie: Movie, opts?: { fromStart?: boolean }) => void;
  onSelectMovie: (movie: Movie) => void;
  onRemove: (key: string) => void;
}) {
  const { movie, percent, progressSec, durationSec } = item;
  const isTv = useIsTvBrowser();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // TVs have no hover — reveal the actions for the focused card instead.
  const showActions = isTv ? true : isHovered || isFocused;

  const remaining = durationSec > 0 ? Math.max(0, durationSec - progressSec) : 0;
  const tag = episodeTag(movie);
  const heading = movie.playlistTitle || movie.title;
  const sub = [
    tag,
    movie.playlistTitle ? movie.title : null,
    remaining > 0 ? formatTimeLeft(remaining) : "Tap to continue",
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <div
      className="group/cw relative flex-shrink-0 w-[220px] md:w-[300px] cursor-pointer outline-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!e.currentTarget.contains(next)) setIsFocused(false);
      }}
      onClick={() => onPlay(movie)}
      tabIndex={0}
      role="button"
      aria-label={`${heading} — resume playing`}
      onKeyDown={(e) => {
        // Inner buttons activate natively — only the card itself resumes here.
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onPlay(movie);
        }
      }}
    >
      <div
        className={`relative overflow-hidden rounded-md bg-white/5 ring-1 transition-all duration-300 ${
          isHovered || isFocused ? "ring-white/30 scale-[1.03]" : "ring-white/10"
        }`}
      >
        <div className="legacy-media">
          <SmartImage
            src={movieImageSources(movie)}
            alt={heading}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Center play affordance */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 pointer-events-none ${
            showActions ? "opacity-100 bg-black/35" : "opacity-0"
          }`}
        >
          <span className="w-12 h-12 rounded-full bg-white/95 flex items-center justify-center shadow-xl">
            <Play size={20} fill="black" className="text-black ml-0.5" />
          </span>
        </div>

        {/* Top-right: restart + remove */}
        <div className="absolute top-2 right-2 flex gap-1.5">
          {durationSec > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(movie, { fromStart: true });
              }}
              className="w-7 h-7 rounded-full bg-black/60 hover:bg-black flex items-center justify-center"
              title="Play from start"
              aria-label={`Play ${heading} from start`}
            >
              <RotateCcw size={13} className="text-white" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.key);
            }}
            className="w-7 h-7 rounded-full bg-black/60 hover:bg-black flex items-center justify-center"
            title="Remove from Continue Watching"
            aria-label={`Remove ${heading} from Continue Watching`}
          >
            <X size={14} className="text-white" />
          </button>
        </div>

        {/* Bottom-right: details */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelectMovie(movie);
          }}
          className={`absolute bottom-3 right-2 w-7 h-7 rounded-full border-2 border-gray-500 bg-black/60 hover:border-white flex items-center justify-center transition-opacity ${
            showActions ? "opacity-100" : "opacity-0"
          }`}
          title="More info"
          aria-label={`More info about ${heading}`}
        >
          <ChevronDown size={14} className="text-white" />
        </button>

        {/* Progress bar */}
        {durationSec > 0 ? (
          <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/25">
            <div className="h-full bg-red-600" style={{ width: `${Math.round(percent * 100)}%` }} />
          </div>
        ) : (
          <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/10" />
        )}
      </div>

      <p className="text-gray-200 text-xs mt-1.5 truncate px-0.5 font-medium">{heading}</p>
      <p className="text-gray-500 text-[11px] truncate px-0.5">{sub}</p>
    </div>
  );
}

export default memo(ContinueWatchingRow);
