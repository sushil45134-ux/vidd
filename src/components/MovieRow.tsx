import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Movie } from "../data";
import MovieCard from "./MovieCard";

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


  const handleScroll = () => {
    if (rowRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
      setShowLeftArrow(scrollLeft > 20);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 20);
    }
  };

  const scroll = (direction: "left" | "right") => {
    if (rowRef.current) {
      const scrollAmount = rowRef.current.clientWidth * 0.8;
      rowRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="tv-row relative px-4 md:px-12 mb-8 group/row">
      {title && (
        <h2 className={`text-white ${TITLE_SIZE_CLASS[titleSize] || TITLE_SIZE_CLASS.lg} font-bold mb-2 hover:text-gray-300 cursor-pointer transition-colors`}>
          {title}
        </h2>
      )}


      <div className="tv-row-inner relative -mx-1">
        {showLeftArrow && (
          <button
            onClick={() => scroll("left")}
            className="tv-scroll-arrow absolute left-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all opacity-0 group-hover/row:opacity-100 rounded-r"
          >
            <ChevronLeft size={36} className="text-white" />
          </button>
        )}

        <div
          ref={rowRef}
          onScroll={handleScroll}
          className="tv-row-track flex gap-1.5 overflow-x-scroll scrollbar-hide scroll-smooth py-4 px-1"
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
            className="tv-scroll-arrow absolute right-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all opacity-0 group-hover/row:opacity-100 rounded-l"
          >
            <ChevronRight size={36} className="text-white" />
          </button>
        )}
      </div>
    </div>
  );
}
