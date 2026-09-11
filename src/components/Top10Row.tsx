import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Movie } from "../data";
import { movieImageSources } from "../lib/media";
import SmartImage from "./SmartImage";
import { isTvBrowser } from "../lib/browser";

interface Top10RowProps {
  title: string;
  movies: Movie[];
  onSelectMovie: (movie: Movie) => void;
}

export default function Top10Row({ title, movies, onSelectMovie }: Top10RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  // No hover on TV: keep the scroll arrows visible and remote-focusable.
  const isTv = isTvBrowser();

  const handleCardKeyDown = (e: React.KeyboardEvent, movie: Movie) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
      e.preventDefault();
      onSelectMovie(movie);
    }
  };

  const handleScroll = () => {
    if (rowRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
      setShowLeftArrow(scrollLeft > 20);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 20);
    }
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
    // Instant, card-snapped paging for Tizen (mirrors MovieRow).
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

  const numberStyles = ["text-[120px] md:text-[180px]"];

  return (
    <div className="relative px-4 md:px-12 mb-8 group/row">
      <h2 className="text-white text-lg md:text-xl font-bold mb-2">{title}</h2>

      <div className="relative -mx-1">
        {/* Left Arrow */}
        {showLeftArrow && (
          <button
            onClick={() => scroll("left")}
            className={`absolute left-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all rounded-r ${
              isTv ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
            }`}
          >
            <ChevronLeft size={36} className="text-white" />
          </button>
        )}

        {/* Cards */}
        <div
          ref={rowRef}
          onScroll={handleScroll}
          className={`flex gap-2 overflow-x-scroll ${isTv ? "" : "scroll-smooth"} py-4 px-1`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {movies.slice(0, 10).map((movie, index) => (
            <div
              key={movie.id}
              className="relative flex-shrink-0 flex items-end cursor-pointer group/card hover:z-30"
              onClick={() => onSelectMovie(movie)}
              tabIndex={0}
              role="button"
              aria-label={`${movie.title} — open details`}
              onKeyDown={(e) => handleCardKeyDown(e, movie)}
            >
              {/* Large Number */}
              <span
                className={`${numberStyles[0]} font-black leading-none select-none`}
                style={{
                  WebkitTextStroke: "3px #808080",
                  color: "transparent",
                  fontFamily: "Arial Black, sans-serif",
                  marginRight: "-20px",
                  zIndex: 0,
                }}
              >
                {index + 1}
              </span>

              {/* Movie Poster */}
              <div className="legacy-media relative w-[200px] md:w-[260px] rounded overflow-hidden z-10 group-hover/card:scale-105 transition-transform duration-300">
                <SmartImage
                  src={movieImageSources(movie)}
                  alt={movie.title}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Right Arrow */}
        {showRightArrow && (
          <button
            onClick={() => scroll("right")}
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
