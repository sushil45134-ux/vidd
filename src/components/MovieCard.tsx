import { memo, useCallback, useMemo } from "react";
import { useState } from "react";
import { Play, Plus, Check, ThumbsUp, ChevronDown, Trash2, Image as ImageIcon } from "lucide-react";
import type { Movie } from "../data";
import { movieImageSources } from "../lib/media";
import SmartImage from "./SmartImage";
import { useIsTvBrowser } from "../hooks/useIsTvBrowser";

interface MovieCardProps {
  movie: Movie;
  isLarge?: boolean;
  /**
   * Stable parent callbacks — the card invokes them with its own movie, so no
   * per-card closures are created on re-render and memo() actually holds.
   */
  onSelectMovie: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  isInMyList: boolean;
  isLiked: boolean;
  onToggleMyList: (movie: Movie) => void;
  onToggleLike: (movieId: number) => void;
  canDelete?: boolean;
  onDelete?: (movie: Movie) => void;
  canEditThumbnail?: boolean;
  onEditThumbnail?: (movie: Movie) => void;
}

function MovieCard({
  movie,
  isLarge = false,
  onSelectMovie,
  onPlay,
  isInMyList,
  isLiked,
  onToggleMyList,
  onToggleLike,
  canDelete = false,
  onDelete,
  canEditThumbnail = false,
  onEditThumbnail,
}: MovieCardProps) {
  const IS_TV = useIsTvBrowser();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  // TVs have no hover. Rendering the full action row (Play / My List / Like /
  // Info / …) on every card permanently multiplies the TV's initial DOM and
  // forces the D-pad to tab through dozens of off-screen buttons, so on TVs
  // the action row is materialized only for the currently focused card.
  // Desktop keeps the pure hover behaviour.
  const showHoverDetails = IS_TV ? isFocused : isHovered;

  const handleCardFocus = useCallback(() => setIsFocused(true), []);
  const handleCardBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    // Moving between the card's own buttons must not tear the row down.
    const next = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(next)) setIsFocused(false);
  }, []);

  const handleOpen = useCallback(() => onSelectMovie(movie), [onSelectMovie, movie]);
  const handlePlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onPlay(movie);
    },
    [onPlay, movie],
  );
  const handleToggleMyList = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleMyList(movie);
    },
    [onToggleMyList, movie],
  );
  const handleToggleLike = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleLike(movie.id);
    },
    [onToggleLike, movie.id],
  );
  const handleMoreInfo = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectMovie(movie);
    },
    [onSelectMovie, movie],
  );
  const handleEditThumbnail = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEditThumbnail?.(movie);
    },
    [onEditThumbnail, movie],
  );

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    // Activate the card only when the card itself (not an inner button)
    // holds focus — inner buttons activate natively on Enter/Space.
    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
      e.preventDefault();
      handleOpen();
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    const label = movie.isCollection ? "playlist" : "video";
    if (window.confirm(`Delete this ${label}: "${movie.title}"? This cannot be undone.`)) {
      onDelete(movie);
    }
  };

  // movieImageSources() builds + dedupes URL arrays; memoize so hover/focus
  // toggles (and parent re-renders) don't rebuild them per render.
  const imageSources = useMemo(() => movieImageSources(movie), [movie]);

  return (
    <div
      className={`movie-card ${isLarge ? "movie-card-large" : ""} relative flex-shrink-0 cursor-pointer transition-transform duration-300 ${
        isLarge ? "w-[280px] md:w-[360px]" : "w-[220px] md:w-[300px]"
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={handleCardFocus}
      onBlur={handleCardBlur}
      onClick={handleOpen}
      tabIndex={0}
      role="button"
      aria-label={`${movie.title} — open details`}
      onKeyDown={handleCardKeyDown}
      data-tv-card-focused={IS_TV && isFocused ? "1" : undefined}
    >
      <div
        className={`movie-card-surface relative overflow-hidden rounded-md transition-all duration-300 ${
          showHoverDetails ? "scale-110 z-30 shadow-2xl shadow-black/80" : "scale-100 z-10"
        }`}
      >
        <div className="legacy-media movie-card-media">
          <SmartImage
            src={imageSources}
            alt={movie.title}
            loading="lazy"
            className="w-full h-full object-cover transition-all duration-300"
          />

          {showHoverDetails && (
            <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
          )}
        </div>

        {showHoverDetails && (
          <div className="bg-[#181818] p-3 rounded-b-md">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={handlePlay}
                className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-gray-200 transition-colors"
                title="Play"
              >
                <Play size={16} fill="black" className="text-black ml-0.5" />
              </button>
              <button
                onClick={handleToggleMyList}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isInMyList ? "border-white bg-white/20" : "border-gray-500 hover:border-white"
                }`}
                title={isInMyList ? "Remove from My List" : "Add to My List"}
              >
                {isInMyList ? (
                  <Check size={16} className="text-white" />
                ) : (
                  <Plus size={16} className="text-white" />
                )}
              </button>
              <button
                onClick={handleToggleLike}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isLiked ? "border-white bg-white/20" : "border-gray-500 hover:border-white"
                }`}
                title={isLiked ? "Unlike" : "Like"}
              >
                <ThumbsUp size={14} className={isLiked ? "text-white fill-white" : "text-white"} />
              </button>
              <button
                onClick={handleMoreInfo}
                className="w-8 h-8 rounded-full border-2 border-gray-500 flex items-center justify-center hover:border-white transition-colors ml-auto"
                title="More Info"
              >
                <ChevronDown size={16} className="text-white" />
              </button>
              {canDelete && onDelete && (
                <button
                  onClick={handleDeleteClick}
                  className="w-8 h-8 rounded-full border-2 border-red-500/70 flex items-center justify-center bg-red-600/20 hover:bg-red-600 hover:border-red-500 transition-colors"
                  title={movie.isCollection ? "Delete playlist" : "Delete video"}
                >
                  <Trash2 size={14} className="text-white" />
                </button>
              )}
              {canEditThumbnail && onEditThumbnail && (
                <button
                  onClick={handleEditThumbnail}
                  className="w-8 h-8 rounded-full border-2 border-[#f47521]/60 bg-[#f47521]/15 hover:bg-[#f47521] flex items-center justify-center transition-colors"
                  title={movie.isCollection ? "Change series thumbnail" : "Change thumbnail"}
                >
                  <ImageIcon size={14} className="text-white" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs mb-1.5">
              <span className="text-green-500 font-bold">{movie.match}% Match</span>
              <span className="border border-gray-500 text-gray-400 px-1 py-0.5 text-[10px]">
                {movie.rating}
              </span>
              <span className="text-gray-400">{movie.duration}</span>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-white">
              {movie.genre.slice(0, 3).map((g, i) => (
                <span key={g} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gray-600">•</span>}
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {(!showHoverDetails || IS_TV) && (
        <p className="text-gray-300 text-xs mt-1 truncate px-0.5">{movie.title}</p>
      )}
    </div>
  );
}

export default memo(MovieCard);
