import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { Movie } from "../data";
import MovieCard from "./MovieCard";
import { isTvBrowser } from "../lib/browser";
import type { RowSlot } from "../lib/plannedRows";

interface MovieRowProps {
  title: string;
  titleSize?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  movies?: Movie[];
  /** Ordered movie/placeholder slots (planned wishlist rows). Wins over `movies`. */
  slots?: RowSlot[];
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

/**
 * Rows mount only this many cards at first paint and mount the rest once the
 * browser is idle (or the moment the row is scrolled). A big library used to
 * mount every card of every row up front — thousands of DOM nodes of React
 * work before the first frame on phones and TV hardware, which is exactly the
 * "site lags" report. Off-screen cards are invisible either way; images stay
 * loading="lazy" throughout.
 */
const INITIAL_CARDS_PER_ROW = 12;

function MovieRow({
  title,
  titleSize = "lg",
  movies = [],
  slots,
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
  // Deferred card mounting (see INITIAL_CARDS_PER_ROW).
  const [cardCap, setCardCap] = useState<number>(INITIAL_CARDS_PER_ROW);
  const expandCards = useCallback(() => setCardCap(Number.POSITIVE_INFINITY), []);
  useEffect(() => {
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(() => setCardCap(Number.POSITIVE_INFINITY), { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(() => setCardCap(Number.POSITIVE_INFINITY), 2000);
    return () => clearTimeout(t);
  }, []);
  // Tizen 5.5 animates every scroll on its slow compositor, so smooth
  // scrolling makes row paging feel laggy and lands on half-cut cards.
  const isTv = isTvBrowser();

  const scrollRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);
  const handleScroll = () => {
    expandCards();
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
    <div className="relative px-4 md:px-12 mb-8 group/row cv-row">
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
          {(slots ?? movies.map((movie) => ({ kind: "movie" as const, movie })))
            .slice(0, cardCap)
            .map((slot, index) =>
              slot.kind === "movie" ? (
                <MovieCard
                  key={slot.movie.id}
                  movie={slot.movie}
                  isLarge={isLargeRow}
                  onClick={() => onSelectMovie(slot.movie)}
                  onPlay={onPlay}
                  isInMyList={isInMyList(slot.movie.id)}
                  isLiked={isLiked(slot.movie.id)}
                  onToggleMyList={() => toggleMyList(slot.movie)}
                  onToggleLike={() => toggleLike(slot.movie.id)}
                  canDelete={canDelete}
                  onDelete={onDelete}
                  canEditThumbnail={canEditThumbnail}
                  onEditThumbnail={onEditThumbnail}
                />
              ) : (
                <PlaceholderCard key={`planned-${index}`} title={slot.title} isLarge={isLargeRow} />
              ),
            )}
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

/**
 * "Coming Soon" slot for planned titles missing from the library. Same
 * footprint as MovieCard so the row keeps its shape; turns into the real
 * card automatically once the title is added.
 */
function PlaceholderCard({ title, isLarge = false }: { title: string; isLarge?: boolean }) {
  return (
    <div
      className={`relative flex-shrink-0 ${isLarge ? "w-[280px] md:w-[360px]" : "w-[220px] md:w-[300px]"}`}
      title={`${title} — coming soon`}
    >
      <div className="relative overflow-hidden rounded-md border-2 border-dashed border-white/15 bg-white/[0.03]">
        <div className="legacy-media">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="w-11 h-11 rounded-full bg-white/5 ring-1 ring-white/10 flex items-center justify-center">
              <Clock size={18} className="text-white/40" />
            </span>
            <p className="text-white/70 text-sm font-semibold leading-snug line-clamp-2">{title}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ff6a00]/80">
              Coming Soon
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(MovieRow);
