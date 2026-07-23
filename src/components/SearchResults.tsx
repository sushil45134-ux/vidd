import { Play, Plus, Check, ThumbsUp } from "lucide-react";
import type { Movie } from "../data";

interface SearchResultsProps {
  results: Movie[];
  query: string;
  onSelectMovie: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  isInMyList: (movieId: number) => boolean;
  isLiked: (movieId: number) => boolean;
  toggleMyList: (movie: Movie) => void;
  toggleLike: (movieId: number) => void;
}

export default function SearchResults({
  results,
  query,
  onSelectMovie,
  onPlay,
  isInMyList,
  isLiked,
  toggleMyList,
  toggleLike,
}: SearchResultsProps) {
  return (
    <div className="tv-section pt-6 px-4 md:px-12 min-h-screen">
      <h2 className="text-gray-400 text-sm mb-6">
        {results.length > 0 ? (
          <>
            Showing results for{" "}
            <span className="text-white font-semibold">"{query}"</span>
            <span className="text-gray-500 ml-2">
              ({results.length} {results.length === 1 ? "result" : "results"})
            </span>
          </>
        ) : (
          <>
            No results found for{" "}
            <span className="text-white font-semibold">"{query}"</span>
          </>
        )}
      </h2>

      {results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-gray-400 text-lg mb-2">
            Your search for "{query}" did not have any matches.
          </p>
          <p className="text-gray-500 text-sm">Suggestions:</p>
          <ul className="text-gray-500 text-sm mt-2 list-disc list-inside">
            <li>Try different keywords</li>
            <li>Looking for a movie or TV show?</li>
            <li>Try using a movie title, actor, or genre</li>
          </ul>
        </div>
      )}

      <div className="tv-card-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {results.map((movie) => (
          <div key={movie.id} className="tv-grid-item group">
            <div
              className="tv-card-media relative overflow-hidden rounded-md aspect-video bg-gray-800 cursor-pointer"
              onClick={() => onSelectMovie(movie)}
            >
              <img
                src={movie.image}
                alt={movie.title}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors duration-300" />

              {/* Hover action buttons */}
              <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-t from-black/80 to-transparent">
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay(movie);
                    }}
                    className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:bg-gray-200 transition-colors"
                    title="Play"
                  >
                    <Play size={14} fill="black" className="text-black ml-0.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMyList(movie);
                    }}
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isInMyList(movie.id)
                        ? "border-white bg-white/20"
                        : "border-gray-400 hover:border-white"
                    }`}
                    title={isInMyList(movie.id) ? "Remove from My List" : "Add to My List"}
                  >
                    {isInMyList(movie.id) ? (
                      <Check size={14} className="text-white" />
                    ) : (
                      <Plus size={14} className="text-white" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLike(movie.id);
                    }}
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isLiked(movie.id)
                        ? "border-white bg-white/20"
                        : "border-gray-400 hover:border-white"
                    }`}
                    title={isLiked(movie.id) ? "Unlike" : "Like"}
                  >
                    <ThumbsUp
                      size={12}
                      className={isLiked(movie.id) ? "text-white fill-white" : "text-white"}
                    />
                  </button>
                </div>
                <p className="text-green-500 text-xs font-bold">{movie.match}% Match</p>
              </div>
            </div>
            <p className="text-gray-300 text-sm mt-2 truncate">{movie.title}</p>
            <p className="text-gray-500 text-xs truncate">
              {movie.genre.join(" • ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
