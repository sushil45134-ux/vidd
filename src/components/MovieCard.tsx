import { useState } from "react";
import { Play, Plus, Check, ThumbsUp, ChevronDown, Trash2, Image as ImageIcon } from "lucide-react";
import type { Movie } from "../data";

interface MovieCardProps {
  movie: Movie;
  isLarge?: boolean;
  onClick: () => void;
  onPlay: (movie: Movie) => void;
  isInMyList: boolean;
  isLiked: boolean;
  onToggleMyList: () => void;
  onToggleLike: () => void;
  canDelete?: boolean;
  onDelete?: (movie: Movie) => void;
  canEditThumbnail?: boolean;
  onEditThumbnail?: (movie: Movie) => void;
}


export default function MovieCard({
  movie,
  isLarge = false,
  onClick,
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
  const [isHovered, setIsHovered] = useState(false);


  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    const label = movie.isCollection ? "playlist" : "video";
    if (window.confirm(`Delete this ${label}: "${movie.title}"? This cannot be undone.`)) {
      onDelete(movie);
    }
  };

  return (
    <div
      className={`relative flex-shrink-0 cursor-pointer transition-transform duration-300 ${
        isLarge ? "w-[280px] md:w-[360px]" : "w-[220px] md:w-[300px]"
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      <div
        className={`relative overflow-hidden rounded-md transition-all duration-300 ${
          isHovered ? "scale-110 z-30 shadow-2xl shadow-black/80" : "scale-100 z-10"
        }`}
      >
        <img
          src={movie.image}
          alt={movie.title}
          className="w-full aspect-video object-cover transition-all duration-300"
        />



        {isHovered && (
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
        )}

        {isHovered && (
          <div className="bg-[#181818] p-3 rounded-b-md">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(movie);
                }}
                className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-gray-200 transition-colors"
                title="Play"
              >
                <Play size={16} fill="black" className="text-black ml-0.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMyList();
                }}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isInMyList
                    ? "border-white bg-white/20"
                    : "border-gray-500 hover:border-white"
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
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLike();
                }}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isLiked
                    ? "border-white bg-white/20"
                    : "border-gray-500 hover:border-white"
                }`}
                title={isLiked ? "Unlike" : "Like"}
              >
                <ThumbsUp
                  size={14}
                  className={isLiked ? "text-white fill-white" : "text-white"}
                />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
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
              {canEditThumbnail && onEditThumbnail && !movie.isCollection && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditThumbnail(movie);
                  }}
                  className="w-8 h-8 rounded-full border-2 border-[#f47521]/60 bg-[#f47521]/15 hover:bg-[#f47521] flex items-center justify-center transition-colors"
                  title="Change thumbnail"
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

      {!isHovered && (
        <p className="text-gray-300 text-xs mt-1 truncate px-0.5">{movie.title}</p>
      )}
    </div>
  );
}
