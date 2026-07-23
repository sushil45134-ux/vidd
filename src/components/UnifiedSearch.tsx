import { useState, useMemo } from "react";
import { Search, X, Play } from "lucide-react";
import type { Movie } from "../data";

interface Props {
  onPlay: (movie: Movie) => void;
  onAdd: (movie: Movie) => void;
  library: Movie[];
  onSelectMovie: (movie: Movie) => void;
}

export default function UnifiedSearch({ onPlay, library, onSelectMovie }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.genre.some((g) => g.toLowerCase().includes(q)) ||
        (m.description || "").toLowerCase().includes(q) ||
        (m.creator || "").toLowerCase().includes(q)
    );
  }, [query, library]);

  return (
    <div className="pt-6 px-4 md:px-12 min-h-screen bg-[#141414]">
      <div className="max-w-3xl mx-auto mb-8">
        <div className="flex items-center bg-[#222] border border-gray-700 rounded-lg overflow-hidden focus-within:border-[#e50914] transition-colors">
          <Search size={20} className="text-gray-400 ml-4 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library..."
            className="flex-1 bg-transparent text-white px-3 py-3.5 text-sm outline-none placeholder-gray-500"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-gray-500 hover:text-white px-3"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <p className="text-gray-500 text-xs mt-2 text-center">
          {filtered.length} {filtered.length === 1 ? "title" : "titles"} in your library
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-gray-400 text-lg mb-2">
            {library.length === 0
              ? "No content yet"
              : `No matches for "${query}"`}
          </p>
          <p className="text-gray-600 text-sm">
            {library.length === 0
              ? "Upload a video or sync a playlist to get started"
              : "Try a different keyword"}
          </p>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((m) => (
            <div
              key={m.id}
              className="group bg-[#1a1a1a] rounded-lg overflow-hidden hover:bg-[#222] transition-colors border border-gray-800 hover:border-gray-700 cursor-pointer"
              onClick={() => onSelectMovie(m)}
            >
              <div className="relative aspect-video bg-gray-900">
                <img
                  src={m.image}
                  alt={m.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay(m.episodes?.[0] || m);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-12 h-12 rounded-full bg-white/90 flex items-center justify-center"
                  >
                    <Play size={20} className="text-black ml-0.5" fill="black" />
                  </button>
                </div>
              </div>
              <div className="p-3">
                <h4 className="text-white text-sm font-medium line-clamp-2 mb-1 leading-tight">
                  {m.title}
                </h4>
                <p className="text-gray-500 text-xs truncate">
                  {m.genre.slice(0, 2).join(" • ")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
