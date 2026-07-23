import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Movie } from "../data";

interface Top10RowProps {
  title: string;
  movies: Movie[];
  onSelectMovie: (movie: Movie) => void;
}

export default function Top10Row({ title, movies, onSelectMovie }: Top10RowProps) {
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

  const numberStyles = [
    "text-[120px] md:text-[180px]",
  ];

  return (
    <div className="tv-row relative px-4 md:px-12 mb-8 group/row">
      <h2 className="text-white text-lg md:text-xl font-bold mb-2">
        {title}
      </h2>

      <div className="tv-row-inner relative -mx-1">
        {/* Left Arrow */}
        {showLeftArrow && (
          <button
            onClick={() => scroll("left")}
            className="tv-scroll-arrow absolute left-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all opacity-0 group-hover/row:opacity-100 rounded-r"
          >
            <ChevronLeft size={36} className="text-white" />
          </button>
        )}

        {/* Cards */}
        <div
          ref={rowRef}
          onScroll={handleScroll}
          className="tv-row-track flex gap-2 overflow-x-scroll scroll-smooth py-4 px-1"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {movies.slice(0, 10).map((movie, index) => (
            <div
              key={movie.id}
              className="tv-row-card relative flex-shrink-0 flex items-end cursor-pointer group/card hover:z-30"
              onClick={() => onSelectMovie(movie)}
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
              <div className="tv-card-media relative w-[200px] md:w-[260px] aspect-video rounded overflow-hidden z-10 group-hover/card:scale-105 transition-transform duration-300">
                <img
                  src={movie.image}
                  alt={movie.title}
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
            className="tv-scroll-arrow absolute right-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/80 flex items-center justify-center transition-all opacity-0 group-hover/row:opacity-100 rounded-l"
          >
            <ChevronRight size={36} className="text-white" />
          </button>
        )}
      </div>
    </div>
  );
}
