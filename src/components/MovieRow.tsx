import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { Movie } from "../data";
import MovieCard from "./MovieCard";
import { isTvBrowser } from "../lib/browser";
import type { RowSlot } from "../lib/plannedRows";

const IS_TV = isTvBrowser();

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
 * Rows mount only this many cards at first paint, grow a little once the
 * browser is idle, and page in more as the row is scrolled toward its end.
 * Mounting every card of every row up front used to create thousands of DOM
 * nodes (and image decoders) before the first frame on phones and TV
 * hardware — exactly the "site lags" report. Off-screen cards stay
 * unmounted until they are about to be seen; images stay loading="lazy"
 * throughout.
 *
 * TV gets even fewer initial cards — Tizen 5.5 SoC is the weakest in fleet,
 * so 6 cards paint ~100x faster than 30 and D-pad stays 60fps.
 */
const INITIAL_CARDS_PER_ROW_DESKTOP = 10;
const INITIAL_CARDS_PER_ROW_TV = 6;
const IDLE_CARDS_PER_ROW_DESKTOP = 30;
const IDLE_CARDS_PER_ROW_TV = 12;
const SCROLL_PAGE_SIZE = 30;
const SCROLL_PAGE_SIZE_TV = 12;
/** Start paging in the next chunk this far (px) before the row end. */
const SCROLL_PREFETCH_PX = 900;

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
  const isTv = IS_TV;
  const rowRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  // Deferred card mounting (see INITIAL_CARDS_PER_ROW).
  // TV: 6 initial, 12 idle for 100x faster first paint on Tizen SoC.
  const INITIAL_CARDS_PER_ROW = isTv ? INITIAL_CARDS_PER_ROW_TV : INITIAL_CARDS_PER_ROW_DESKTOP;
  const IDLE_CARDS_PER_ROW = isTv ? IDLE_CARDS_PER_ROW_TV : IDLE_CARDS_PER_ROW_DESKTOP;
  const PAGE_SIZE = isTv ? SCROLL_PAGE_SIZE_TV : SCROLL_PAGE_SIZE;
  const [cardCap, setCardCap] = useState<number>(INITIAL_CARDS_PER_ROW);
  const expandCards = useCallback(() => {
    setCardCap((cap) => (cap >= IDLE_CARDS_PER_ROW ? cap + PAGE_SIZE : IDLE_CARDS_PER_ROW));
  }, [IDLE_CARDS_PER_ROW, PAGE_SIZE]);
  useEffect(() => {
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(() => setCardCap(IDLE_CARDS_PER_ROW), { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(() => setCardCap(IDLE_CARDS_PER_ROW), 2000);
    return () => clearTimeout(t);
  }, [IDLE_CARDS_PER_ROW]);
  // Tizen 5.5 animates every scroll on its slow compositor, so smooth
  // scrolling makes row paging feel laggy and lands on half-cut cards.

  const scrollRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);
  const handleScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      if (rowRef.current) {
        const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
        setShowLeftArrow(scrollLeft > 20);
        setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 20);
        // Page in the next chunk before the user hits the mounted end.
        if (scrollLeft + clientWidth > scrollWidth - SCROLL_PREFETCH_PX) expandCards();
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

  const items = slots ?? movies.map((movie) => ({ kind: "movie" as const, movie }));
  const visibleItems = items.slice(0, cardCap);
  const hasMore = items.length > visibleItems.length;

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
          // scroll-smooth would animate even a direct scrollLeft write, so it
          // must not exist on TV rows at all.
          className={`flex gap-1.5 overflow-x-scroll scrollbar-hide ${
            isTv ? "" : "scroll-smooth"
          } py-4 px-1`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {visibleItems.map((slot, index) =>
            slot.kind === "movie" ? (
              <MovieCard
                key={slot.movie.id}
                movie={slot.movie}
                isLarge={isLargeRow}
                onSelectMovie={onSelectMovie}
                onPlay={onPlay}
                isInMyList={isInMyList(slot.movie.id)}
                isLiked={isLiked(slot.movie.id)}
                onToggleMyList={toggleMyList}
                onToggleLike={toggleLike}
                canDelete={canDelete}
                onDelete={onDelete}
                canEditThumbnail={canEditThumbnail}
                onEditThumbnail={onEditThumbnail}
              />
            ) : (
              <PlaceholderCard key={`planned-${index}`} title={slot.title} isLarge={isLargeRow} />
            ),
          )}
          {hasMore && (
            <button
              onClick={expandCards}
              className={`relative flex-shrink-0 self-stretch min-h-[120px] rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition ${
                isLargeRow ? "w-[140px]" : "w-[120px]"
              }`}
              aria-label={`Show more in ${title || "this row"}`}
            >
              Show more
              <span className="block text-[10px] text-white/50 font-normal mt-1">
                {visibleItems.length} of {items.length}
              </span>
            </button>
          )}
        </div>

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
