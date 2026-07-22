import { useEffect, useMemo, useState } from "react";
import { X, Play, Bookmark, Plus, Star, ChevronRight, ChevronLeft, Trash2, Sparkles, Image as ImageIcon } from "lucide-react";
import type { Movie, Season } from "../data";
import HeroBannerPicker from "./HeroBannerPicker";

interface MovieModalProps {
  movie: Movie;
  onClose: () => void;
  onPlay: (movie: Movie) => void;
  isInMyList: boolean;
  isLiked: boolean;
  onToggleMyList: () => void;
  onToggleLike: () => void;
  onSelectMovie: (movie: Movie) => void;
  allMovies: Movie[];
  canDelete?: boolean;
  onDelete?: (movie: Movie) => void;
  canEditThumbnail?: boolean;
  onEditThumbnail?: (movie: Movie) => void;
}


export default function MovieModal({
  movie,
  onClose,
  onPlay,
  isInMyList,
  onToggleMyList,
  onSelectMovie,
  allMovies,
  canDelete = false,
  onDelete,
  canEditThumbnail = false,
  onEditThumbnail,
}: MovieModalProps) {
  const [showBannerPicker, setShowBannerPicker] = useState(false);

  const isCollection = !!(movie.isCollection && movie.episodes && movie.episodes.length > 0);
  const seasons: Season[] = useMemo(() => {
    if (!isCollection) return [];
    if (movie.seasons && movie.seasons.length > 0) return movie.seasons;
    // Fallback: single synthetic season from flat episodes
    return [{ seasonNumber: 1, episodes: movie.episodes! }];
  }, [isCollection, movie.seasons, movie.episodes]);

  const hasMultiSeason = seasons.length > 1;
  // null = show season picker; number = show that season's episodes
  const [selectedSeason, setSelectedSeason] = useState<number | null>(
    hasMultiSeason ? null : (seasons[0]?.seasonNumber ?? null)
  );
  const [selectedEpIdx, setSelectedEpIdx] = useState(0);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  useEffect(() => {
    setSelectedSeason(hasMultiSeason ? null : (seasons[0]?.seasonNumber ?? null));
    setSelectedEpIdx(0);
  }, [movie.id, hasMultiSeason, seasons]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const activeSeason: Season | undefined =
    selectedSeason != null ? seasons.find((s) => s.seasonNumber === selectedSeason) : undefined;
  const episodes: Movie[] = activeSeason ? activeSeason.episodes : [];
  const currentEp: Movie = isCollection
    ? (episodes[selectedEpIdx] || episodes[0] || movie.episodes![0])
    : movie;

  const similarMovies = useMemo(() => {
    if (isCollection) return [];
    const g = new Set(movie.genre);
    return allMovies
      .filter((m) => m.id !== movie.id && m.genre.some((x) => g.has(x)))
      .slice(0, 8);
  }, [movie, allMovies, isCollection]);

  const kind = movie.genre.some((g) => g.toLowerCase() === "anime")
    ? "Anime"
    : movie.genre.some((g) => g.toLowerCase() === "cartoon")
    ? "Cartoon"
    : (movie.rating || "").startsWith("TV")
    ? "Show"
    : "Movie";

  const rating = Math.max(0, Math.min(5, Math.round(((movie.match || 80) / 20))));
  const votes = 100 + ((movie.id * 37) % 900);

  const showSeasonPicker = isCollection && hasMultiSeason && selectedSeason == null;

  const heroTitle = movie.title;
  const moviePoster = movie.thumbnailUrl || movie.image || movie.backdrop;
  const episodePoster = currentEp.thumbnailUrl || currentEp.image || currentEp.backdrop;
  const heroImage = showSeasonPicker
    ? moviePoster
    : (isCollection ? episodePoster : moviePoster);
  const heroDesc = showSeasonPicker
    ? `${seasons.length} seasons • ${movie.episodes!.length} episodes`
    : isCollection
    ? `Season ${activeSeason?.seasonNumber} • Episode ${currentEp.episodeNumber || selectedEpIdx + 1}: ${currentEp.title}`
    : movie.description;

  const episodeCount = isCollection ? movie.episodes!.length : 0;

  const playFirstOfFirstSeason = () => {
    const s = seasons[0];
    if (s && s.episodes[0]) onPlay(s.episodes[0]);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl mx-4 bg-[#0b0b0f] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div className="relative aspect-[16/9] w-full">
          <img
            src={heroImage}
            alt={heroTitle}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-black/15" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0f] via-transparent to-transparent" />

          {!isCollection && heroImage && (
            <div className="pointer-events-none absolute right-6 bottom-24 top-20 z-[2] hidden w-[28%] max-w-[260px] min-w-[180px] overflow-hidden rounded-xl ring-1 ring-white/15 shadow-2xl shadow-black/60 md:block">
              <img
                src={heroImage}
                alt={`${heroTitle} poster`}
                className="h-full w-full object-cover"
              />
            </div>
          )}

          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 hover:bg-black/90 flex items-center justify-center z-10"
          >
            <X size={18} className="text-white" />
          </button>

          {isCollection && hasMultiSeason && selectedSeason != null && (
            <button
              onClick={() => {
                setSelectedSeason(null);
                setSelectedEpIdx(0);
              }}
              className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white text-xs z-10"
            >
              <ChevronLeft size={14} /> Back to Seasons
            </button>
          )}

          <div className="absolute inset-y-0 left-0 flex items-center">
              <div className="px-6 md:px-12 max-w-2xl md:max-w-[58%] relative z-[3]">
              <p className="text-white/70 text-xs md:text-sm mb-2">
                You're watching {kind}
              </p>
              <h2 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tight mb-3">
                {heroTitle}
              </h2>
              <p className="text-white/70 text-sm md:text-[15px] leading-relaxed mb-4 line-clamp-3">
                {heroDesc}
              </p>

              <div className="flex items-center gap-2 mb-6">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={16}
                      className={
                        i < rating
                          ? "text-[#f47521] fill-[#f47521]"
                          : "text-white/25"
                      }
                    />
                  ))}
                </div>
                <span className="text-white/60 text-xs">{votes} votes</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (showSeasonPicker) playFirstOfFirstSeason();
                    else onPlay(currentEp);
                  }}
                  className="flex items-center gap-2 bg-[#f47521] hover:bg-[#ff8636] text-white font-semibold pl-5 pr-4 py-2.5 rounded-full text-sm transition-colors active:scale-95"
                >
                  {showSeasonPicker
                    ? `Play S${seasons[0]?.seasonNumber} E${seasons[0]?.episodes[0]?.episodeNumber || 1}`
                    : isCollection
                    ? `Play Episode ${currentEp.episodeNumber || selectedEpIdx + 1}`
                    : "Continue Watching"}
                  <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center">
                    <Play size={12} fill="white" className="text-white ml-0.5" />
                  </span>
                </button>
                <button
                  onClick={onToggleMyList}
                  className="flex items-center gap-2 border border-white/30 hover:border-white text-white font-semibold px-5 py-2.5 rounded-full text-sm transition-colors"
                >
                  {isInMyList ? "Following" : `Follow ${kind}`}
                </button>
                {canDelete && onDelete && (
                  <button
                    onClick={() => {
                      const label = isCollection ? "playlist" : "video";
                      if (window.confirm(`Delete this ${label}: "${movie.title}"? This cannot be undone.`)) {
                        onDelete(movie);
                        onClose();
                      }
                    }}
                    className="flex items-center gap-2 border border-red-500/60 bg-red-600/20 hover:bg-red-600 text-white font-semibold px-4 py-2.5 rounded-full text-sm transition-colors"
                    title={isCollection ? "Delete playlist" : "Delete video"}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => setShowBannerPicker(true)}
                    className="flex items-center gap-2 border border-[#ff6a00]/60 bg-[#ff6a00]/15 hover:bg-[#ff6a00] hover:text-black text-white font-semibold px-4 py-2.5 rounded-full text-sm transition-colors"
                    title="Set as hero banner"
                  >
                    <Sparkles size={14} />
                    Set as Hero
                  </button>
                )}
                {canEditThumbnail && onEditThumbnail && !isCollection && (
                  <button
                    onClick={() => onEditThumbnail(movie)}
                    className="flex items-center gap-2 border border-[#f47521]/60 bg-[#f47521]/15 hover:bg-[#f47521] text-white font-semibold px-4 py-2.5 rounded-full text-sm transition-colors"
                    title="Change thumbnail"
                  >
                    <ImageIcon size={14} />
                    Change Thumbnail
                  </button>
                )}

              </div>
            </div>
          </div>
        </div>

        {/* Season tabs (only when a season is selected and more than one exists) */}
        {isCollection && hasMultiSeason && selectedSeason != null && (
          <div className="px-6 md:px-12 border-b border-white/10">
            <div className="flex gap-8 overflow-x-auto scrollbar-hide">
              {seasons.map((s) => (
                <button
                  key={s.seasonNumber}
                  onClick={() => {
                    setSelectedSeason(s.seasonNumber);
                    setSelectedEpIdx(0);
                  }}
                  className={`relative py-4 text-sm font-semibold whitespace-nowrap transition-colors ${
                    selectedSeason === s.seasonNumber ? "text-[#f47521]" : "text-white/60 hover:text-white"
                  }`}
                >
                  Season {s.seasonNumber}
                  {selectedSeason === s.seasonNumber && (
                    <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#f47521] rounded-full" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Meta strip */}
        <div className="px-6 md:px-12 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50 border-b border-white/5">
          <span>{movie.year}</span>
          <span className="text-white/20">|</span>
          {movie.creator && (
            <>
              <span>{movie.creator}</span>
              <span className="text-white/20">|</span>
            </>
          )}
          <span>
            {hasMultiSeason
              ? `${seasons.length} Seasons • ${episodeCount} Episodes`
              : isCollection
              ? `${episodeCount} Episodes`
              : movie.duration || "Movie"}
          </span>
          <span className="text-white/20">|</span>
          <span>{movie.rating}</span>
          <span className="ml-auto">Genres: {movie.genre.join(", ")}</span>
        </div>

        {/* Season cards OR Episodes row OR More Like This */}
        <div className="relative px-6 md:px-12 py-6">
          {showSeasonPicker ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {seasons.map((s) => (
                <SeasonCard
                  key={s.seasonNumber}
                  season={s}
                  onOpen={() => {
                    setSelectedSeason(s.seasonNumber);
                    setSelectedEpIdx(0);
                  }}
                />
              ))}
            </div>
          ) : isCollection ? (
            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
              {episodes.map((ep, i) => (
                <EpisodeCard
                  key={ep.id}
                  movie={ep}
                  index={ep.episodeNumber || i + 1}
                  current={i === selectedEpIdx}
                  onPlay={() => onPlay(ep)}
                  onSelect={() => {
                    setSelectedEpIdx(i);
                    onPlay(ep);
                  }}
                />
              ))}
            </div>
          ) : similarMovies.length > 0 ? (
            <>
              <h3 className="text-white text-lg font-semibold mb-3">More Like This</h3>
              <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
                {similarMovies.map((m) => (
                  <SimilarCard
                    key={m.id}
                    movie={m}
                    onPlay={() => onPlay(m)}
                    onSelect={() => onSelectMovie(m)}
                  />
                ))}
              </div>
            </>
          ) : null}
          {!showSeasonPicker && isCollection && episodes.length > 3 && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black flex items-center justify-center">
              <ChevronRight size={22} className="text-white" />
            </button>
          )}
        </div>
      </div>
      {showBannerPicker && (
        <HeroBannerPicker
          movie={movie}
          onClose={() => setShowBannerPicker(false)}
        />
      )}
    </div>
  );
}


function SeasonCard({ season, onOpen }: { season: Season; onOpen: () => void }) {
  const first = season.episodes[0];
  return (
    <button
      onClick={onOpen}
      className="group relative text-left rounded-lg overflow-hidden bg-white/5 ring-1 ring-white/5 hover:ring-[#f47521]/60 transition-all"
    >
      <div className="relative aspect-video">
        <img
          src={first?.backdrop || first?.image}
          alt={`Season ${season.seasonNumber}`}
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
        <div className="absolute left-3 top-3 px-2 py-1 rounded-md bg-black/60 text-white text-[11px] font-semibold">
          Season {season.seasonNumber}
        </div>
        <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity w-9 h-9 rounded-full bg-[#f47521] flex items-center justify-center">
          <Play size={14} fill="white" className="text-white ml-0.5" />
        </div>
        <div className="absolute left-0 right-0 bottom-0 px-3 pb-2">
          <h4 className="text-white text-sm font-bold">Season {season.seasonNumber}</h4>
          <p className="text-white/70 text-[11px]">
            {season.episodes.length} episode{season.episodes.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </button>
  );
}


function EpisodeCard({
  movie,
  index,
  current = false,
  onPlay,
  onSelect,
}: {
  movie: Movie;
  index: number;
  current?: boolean;
  onPlay: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className="group relative shrink-0 w-64 cursor-pointer"
      onClick={current ? onPlay : onSelect}
    >
      <div className="relative aspect-video rounded-lg overflow-hidden bg-white/5">
        <img
          src={movie.image}
          alt={movie.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="w-7 h-7 rounded-md bg-black/60 hover:bg-black flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Bookmark size={13} className="text-white" />
          </button>
          <button
            className="w-7 h-7 rounded-md bg-black/60 hover:bg-black flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <Plus size={13} className="text-white" />
          </button>
        </div>
        {current && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            className="absolute left-3 bottom-8 w-9 h-9 rounded-full bg-[#f47521] flex items-center justify-center hover:scale-110 transition-transform"
          >
            <Play size={14} fill="white" className="text-white ml-0.5" />
          </button>
        )}
        <div className="absolute left-0 right-0 bottom-0 px-3 pb-2">
          <h4 className="text-white text-sm font-semibold truncate">
            Episode {index}: {movie.title}
          </h4>
          {current && (
            <p className="text-white/60 text-[11px] mt-0.5 line-clamp-1">
              {movie.description}
            </p>
          )}
        </div>
        {current && (
          <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/15">
            <div className="h-full w-1/3 bg-[#f47521]" />
          </div>
        )}
      </div>
    </div>
  );
}

function SimilarCard({
  movie,
  onPlay,
  onSelect,
}: {
  movie: Movie;
  onPlay: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className="group relative shrink-0 w-56 cursor-pointer"
      onClick={onSelect}
    >
      <div className="relative aspect-video rounded-lg overflow-hidden bg-white/5">
        <img src={movie.image} alt={movie.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className="absolute inset-0 m-auto w-11 h-11 rounded-full bg-[#f47521]/90 hover:bg-[#f47521] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
        >
          <Play size={16} fill="white" className="text-white ml-0.5" />
        </button>
        <div className="absolute left-0 right-0 bottom-0 px-3 pb-2">
          <h4 className="text-white text-sm font-semibold truncate">{movie.title}</h4>
          <p className="text-white/50 text-[11px]">{movie.year} • {movie.rating}</p>
        </div>
      </div>
    </div>
  );
}
