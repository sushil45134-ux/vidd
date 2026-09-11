import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Movie } from "../data";
import MovieCard from "./MovieCard";
import { isTvBrowser } from "../lib/browser";

interface MovieRowProps {
  title: string;
  titleSize?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  movies: Movie[];
  isLargeRow?: boolean;
  onSelectMovie: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  isInMyList: (movieId: number) => boolean;
  isLiked: (movieId: number) => boolean;
  toggleMyList: (movie: Movie) => void;
  toggleLike: (movieId: number) => void;
  canDelete?: boolean;
  onDelete?: (movie: Movie) => void;
  canEditThumbnail?: boolean;
  onEditThumbnail?: (movie: Movie) => void;
}

const TITLE_SIZE_CLASS: Record<string, string> = {
  xs: "text-xs md:text-sm",
  sm: "text-sm md:text-base",
  md: "text-base md:text-lg",
  lg: "text-lg md:text-xl",
  xl: "text-xl md:text-2xl",
  "2xl": "text-2xl md:text-3xl",
};

export default function MovieRow({
  title,
  titleSize = "lg",
  movies,
  isLargeRow = false,
  onSelectMovie,
  onPlay,
  isInMyList,
  isLiked,
  toggleMyList,
  toggleLike,
  canDelete = false,
  onDelete,
  canEditThumbnail = false,
  onEditThumbnail,
}: MovieRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  // Tizen 5.5 animates every scroll on its slow compositor, so smooth
  // scrolling makes row paging feel laggy and lands on half-cut cards.
  const isTv = isTvBrowser();

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
    // TV path: one synchronous scrollLeft write — instant, no animation
    // frames, and snapped to whole card steps so paging stays deterministic.
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

  return (
    <div className="relative px-4 md:px-12 mb-8 group/row">
      {title && (
        <h2
          className={`text-white ${TITLE_SIZE_CLASS[titleSize] || TITLE_SIZE_CLASS.lg} font-bold mb-2 hover:text-gray-300 cursor-pointer transition-colors`}
        >
          {title}
        </h2>
      )}

      <div className="relative -mx-1">
        {showLeftArrow && (
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all opacity-0 group-hover/row:opacity-100 rounded-r"
          >
            <ChevronLeft size={36} className="text-white" />
          </button>
        )}

        <div
          ref={rowRef}
          onScroll={handleScroll}
          // scroll-smooth would animate even a direct scrollLeft write, so it
          // must not exist on TV rows at all.
          className={`flex gap-1.5 overflow-x-scroll scrollbar-hide ${
            isTv ? "" : "scroll-smooth"
          } py-4 px-1`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {movies.map((movie) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              isLarge={isLargeRow}
              onClick={() => onSelectMovie(movie)}
              onPlay={onPlay}
              isInMyList={isInMyList(movie.id)}
              isLiked={isLiked(movie.id)}
              onToggleMyList={() => toggleMyList(movie)}
              onToggleLike={() => toggleLike(movie.id)}
              canDelete={canDelete}
              onDelete={onDelete}
              canEditThumbnail={canEditThumbnail}
              onEditThumbnail={onEditThumbnail}
            />
          ))}
        </div>

        {showRightArrow && (
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all opacity-0 group-hover/row:opacity-100 rounded-l"
          >
            <ChevronRight size={36} className="text-white" />
          </button>
        )}
      </div>
    </div>
  );
}
