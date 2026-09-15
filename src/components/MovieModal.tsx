import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Play,
  Bookmark,
  Plus,
  Star,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Sparkles,
  Image as ImageIcon,
} from "lucide-react";
import type { Movie, Season } from "../data";
import { FALLBACK_THUMBNAIL, isGenericPoster, movieImageSources } from "../lib/media";
import HeroBannerPicker from "./HeroBannerPicker";
import SmartImage from "./SmartImage";
import { useVisibleCount } from "../lib/useVisibleCount";
import {
  HERO_SECTION_LABELS,
  bannerSection,
  useHeroBanners,
  removeHeroBanner,
} from "../lib/heroBanners";
import { registerTvBackHandler } from "../lib/spatialNav";
import { useIsTvBrowser } from "../hooks/useIsTvBrowser";
import {
  episodeTag,
  formatClock,
  formatTimeLeft,
  useResumeForMovie,
} from "../lib/continueWatching";

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
  const heroBanners = useHeroBanners();
  const heroBannerForMovie = heroBanners.find((b) => b.movieId === movie.id);
  const isHeroBanner = !!heroBannerForMovie;
  // Continue Watching: exact match for singles, newest episode for series.
  const resume = useResumeForMovie(movie);
  const resumeFromSec =
    resume && resume.durationSec > 0 && resume.progressSec > 0 ? resume.progressSec : 0;

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
    hasMultiSeason ? null : (seasons[0]?.seasonNumber ?? null),
  );
  const [selectedEpIdx, setSelectedEpIdx] = useState(0);
  const previousMovieId = useRef(movie.id);

  // Titles that arrived from a trimmed library page (see moviesRepo
  // fetchAllMovies — pages 2+ skip the heavy description/cast text columns to
  // keep the boot fetch small) get their synopsis filled in here: one tiny
  // single-row query, exactly when someone actually opens the title.
  const needsDetailsFill = !movie.isCollection && !movie.description;
  const [detailsFill, setDetailsFill] = useState<Partial<Movie> | null>(null);
  useEffect(() => {
    setDetailsFill(null);
    if (!needsDetailsFill) return;
    let alive = true;
    import("../lib/moviesRepo")
      .then(({ fetchMovieById }) => fetchMovieById(movie.id))
      .then((full) => {
        if (!alive || !full || !full.description) return;
        setDetailsFill({
          description: full.description,
          cast: full.cast,
          creator: full.creator,
          year: full.year,
          rating: full.rating,
          duration: full.duration,
          match: full.match,
        });
      })
      .catch(() => {
        /* cosmetic fill only — the modal already works without it */
      });
    return () => {
      alive = false;
    };
  }, [needsDetailsFill, movie.id]);
  // Render-time view object: original movie with the fetched text merged in.
  const view: Movie = detailsFill ? { ...movie, ...detailsFill } : movie;

  // Episodes row paging. The forward arrow used to render without any click
  // handler, so it never moved the row. Same desktop/TV split as MovieRow:
  // smooth scroll on desktop, one synchronous card-step on Tizen's slow
  // compositor. The arrow steps aside once the row cannot scroll further.
  const isTv = useIsTvBrowser();
  const episodesRowRef = useRef<HTMLDivElement>(null);
  const episodesRaf = useRef(0);
  const [showEpisodesArrow, setShowEpisodesArrow] = useState(true);

  useEffect(() => () => cancelAnimationFrame(episodesRaf.current), []);

  const updateEpisodesArrow = useCallback(() => {
    cancelAnimationFrame(episodesRaf.current);
    episodesRaf.current = requestAnimationFrame(() => {
      const el = episodesRowRef.current;
      if (!el) return;
      setShowEpisodesArrow(el.scrollLeft < el.scrollWidth - el.clientWidth - 20);
    });
  }, []);

  const scrollEpisodesForward = useCallback(() => {
    const el = episodesRowRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    if (!isTv) {
      el.scrollBy({ left: amount, behavior: "smooth" });
      return;
    }
    const children = el.children;
    let pitch = 0;
    if (children.length >= 2) {
      pitch = (children[1] as HTMLElement).offsetLeft - (children[0] as HTMLElement).offsetLeft;
    }
    if (pitch <= 0 && children.length >= 1) pitch = (children[0] as HTMLElement).offsetWidth || 0;
    if (pitch <= 0) pitch = amount;
    const steps = Math.max(1, Math.round(amount / pitch));
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = Math.max(0, Math.min(max, Math.round(el.scrollLeft + steps * pitch)));
  }, [isTv]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  useEffect(() => {
    const movieChanged = previousMovieId.current !== movie.id;
    previousMovieId.current = movie.id;

    setSelectedSeason((previousSeason) => {
      if (movieChanged || !hasMultiSeason) {
        return hasMultiSeason ? null : (seasons[0]?.seasonNumber ?? null);
      }
      return previousSeason != null && seasons.some((s) => s.seasonNumber === previousSeason)
        ? previousSeason
        : null;
    });
    setSelectedEpIdx(0);
  }, [movie.id, hasMultiSeason, seasons]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  // TV remote BACK pops this modal off the overlay stack (player first).
  useEffect(() => registerTvBackHandler(onClose), [onClose]);

  // On TV, land focus on the primary action so the remote works right away.
  const playButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isTv) return;
    const t = setTimeout(() => playButtonRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // isTv stays false until hydration completes, so the focus pass has to
    // run again once the TV value lands.
  }, [movie.id, isTv]);

  const activeSeason: Season | undefined =
    selectedSeason != null ? seasons.find((s) => s.seasonNumber === selectedSeason) : undefined;
  const episodes: Movie[] = useMemo(
    () => (activeSeason ? activeSeason.episodes : []),
    [activeSeason],
  );
  // 1000+ episode series (One Piece) must not mount 1000 cards at once.
  // Only the on-screen handful mounts synchronously with the modal open —
  // mounting 60 heavy cards in the same frame as the tap is exactly the
  // "tap a movie, whole site freezes" report on phones and TVs.
  const { visible: visibleEps, showMore: showMoreEps } = useVisibleCount(
    `${movie.id}-${selectedSeason ?? "all"}`,
    14,
    40,
  );
  const currentEp: Movie = isCollection
    ? episodes[selectedEpIdx] || episodes[0] || movie.episodes![0]
    : movie;

  const similarMovies = useMemo(() => {
    if (isCollection) return [];
    const g = new Set(movie.genre);
    return allMovies.filter((m) => m.id !== movie.id && m.genre.some((x) => g.has(x))).slice(0, 8);
  }, [movie, allMovies, isCollection]);

  const kind = movie.genre.some((g) => g.toLowerCase() === "anime")
    ? "Anime"
    : movie.genre.some((g) => g.toLowerCase() === "cartoon")
      ? "Cartoon"
      : (movie.rating || "").startsWith("TV")
        ? "Show"
        : "Movie";

  const rating = Math.max(0, Math.min(5, Math.round((movie.match || 80) / 20)));
  const votes = 100 + ((movie.id * 37) % 900);

  const showSeasonPicker = isCollection && hasMultiSeason && selectedSeason == null;

  // Re-measure whenever the visible row content changes.
  useEffect(() => {
    updateEpisodesArrow();
  }, [episodes, showSeasonPicker, updateEpisodesArrow]);

  const heroTitle = movie.title;
  const moviePoster = movieImageSources(movie, "hero");
  // Series cover wins in the hero. Episode-specific stills stay on the
  // episode cards; using the current episode poster here showed the shared
  // Pexels film-strip after the admin set a real series thumbnail.
  const heroImage = moviePoster;
  const heroDesc = showSeasonPicker
    ? `${seasons.length} seasons • ${movie.episodes!.length} episodes`
    : isCollection
      ? `Season ${activeSeason?.seasonNumber} • Episode ${currentEp.episodeNumber || selectedEpIdx + 1}: ${currentEp.title}`
      : view.description;

  const episodeCount = isCollection ? movie.episodes!.length : 0;

  const playFirstOfFirstSeason = () => {
    const s = seasons[0];
    if (s && s.episodes[0]) onPlay(s.episodes[0]);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/85 overflow-y-auto py-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl mx-4 bg-[#0b0b0f] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero — legacy-media padding-ratio is the Chromium 69 aspect-ratio fallback */}
        <div className="legacy-media relative aspect-[16/9] w-full">
          <SmartImage src={heroImage} alt={heroTitle} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-black/15" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0f] via-transparent to-transparent" />

          {!isCollection && heroImage && (
            <div className="pointer-events-none absolute right-6 bottom-24 top-20 z-[2] hidden w-[28%] max-w-[260px] min-w-[180px] overflow-hidden rounded-xl ring-1 ring-white/15 shadow-2xl shadow-black/60 md:block">
              <SmartImage
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
              <p className="text-white/70 text-xs md:text-sm mb-2">You're watching {kind}</p>
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
                      className={i < rating ? "text-[#f47521] fill-[#f47521]" : "text-white/25"}
                    />
                  ))}
                </div>
                <span className="text-white/60 text-xs">{votes} votes</span>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  ref={playButtonRef}
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
                      : resumeFromSec > 0
                        ? `Resume from ${formatClock(resumeFromSec)}`
                        : "Play"}
                  <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center">
                    <Play size={12} fill="white" className="text-white ml-0.5" />
                  </span>
                </button>
                {isCollection && resume && (
                  <button
                    onClick={() => onPlay(resume.movie)}
                    className="flex items-center gap-2 border border-[#f47521]/70 bg-[#f47521]/15 hover:bg-[#f47521] text-white font-semibold px-5 py-2.5 rounded-full text-sm transition-colors whitespace-nowrap"
                    title={`Resume ${resume.movie.title}`}
                  >
                    {resume.durationSec > 0
                      ? `Resume ${episodeTag(resume.movie) || "Episode"} • ${formatTimeLeft(resume.durationSec - resume.progressSec)}`
                      : `Resume ${episodeTag(resume.movie) || "Episode"}`}
                  </button>
                )}
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
                      if (
                        window.confirm(
                          `Delete this ${label}: "${movie.title}"? This cannot be undone.`,
                        )
                      ) {
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
                    className="flex items-center gap-2 border border-[#ff6a00]/60 bg-[#ff6a00]/15 hover:bg-[#ff6a00] hover:text-black text-white font-semibold px-4 py-2.5 rounded-full text-sm transition-colors whitespace-nowrap"
                    title={
                      heroBannerForMovie
                        ? `Banner on ${HERO_SECTION_LABELS[bannerSection(heroBannerForMovie)]} — click to change`
                        : "Set as page banner"
                    }
                  >
                    <Sparkles size={14} />
                    {heroBannerForMovie
                      ? `${HERO_SECTION_LABELS[bannerSection(heroBannerForMovie)]} Banner ✓`
                      : "Set Banner"}
                  </button>
                )}
                {canDelete && heroBannerForMovie && (
                  <button
                    onClick={() => {
                      const label = HERO_SECTION_LABELS[bannerSection(heroBannerForMovie)];
                      if (window.confirm(`Remove "${movie.title}" from the ${label} banner?`)) {
                        removeHeroBanner(movie.id);
                      }
                    }}
                    className="flex items-center gap-2 border border-red-500/60 bg-red-600/15 hover:bg-red-600 text-white font-semibold px-4 py-2.5 rounded-full text-sm transition-colors whitespace-nowrap"
                    title={`Remove from ${HERO_SECTION_LABELS[bannerSection(heroBannerForMovie)]} banner`}
                  >
                    <Trash2 size={14} />
                    Remove Banner
                  </button>
                )}
                {canEditThumbnail && onEditThumbnail && (
                  <button
                    onClick={() => onEditThumbnail(movie)}
                    className="flex items-center gap-2 border border-[#f47521]/60 bg-[#f47521]/15 hover:bg-[#f47521] text-white font-semibold px-4 py-2.5 rounded-full text-sm transition-colors"
                    title={isCollection ? "Change series thumbnail" : "Change thumbnail"}
                  >
                    <ImageIcon size={14} />
                    {isCollection ? "Change Series Thumbnail" : "Change Thumbnail"}
                  </button>
                )}
              </div>
              {!isCollection && resume && resume.durationSec > 0 && (
                <div className="mt-3 max-w-xs">
                  <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                    <div
                      className="h-full bg-[#f47521] rounded-full"
                      style={{ width: `${Math.round(resume.percent * 100)}%` }}
                    />
                  </div>
                  <p className="text-white/60 text-[11px] mt-1.5">
                    {formatTimeLeft(resume.durationSec - resume.progressSec)} left
                  </p>
                </div>
              )}
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
                    selectedSeason === s.seasonNumber
                      ? "text-[#f47521]"
                      : "text-white/60 hover:text-white"
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
          <span>{view.year}</span>
          <span className="text-white/20">|</span>
          {view.creator && (
            <>
              <span>{view.creator}</span>
              <span className="text-white/20">|</span>
            </>
          )}
          <span>
            {hasMultiSeason
              ? `${seasons.length} Seasons • ${episodeCount} Episodes`
              : isCollection
                ? `${episodeCount} Episodes`
                : view.duration || "Movie"}
          </span>
          <span className="text-white/20">|</span>
          <span>{view.rating}</span>
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
            <div
              ref={episodesRowRef}
              onScroll={updateEpisodesArrow}
              className="flex gap-4 overflow-x-auto scrollbar-hide pb-2"
            >
              {episodes.slice(0, visibleEps).map((ep, i) => (
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
                  fallbackMovie={movie}
                  canDelete={canDelete}
                  onDelete={onDelete}
                />
              ))}
              {episodes.length > visibleEps && (
                <button
                  onClick={showMoreEps}
                  className="shrink-0 w-36 self-stretch rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold transition"
                >
                  Show {Math.min(40, episodes.length - visibleEps)} more
                  <span className="block text-[10px] text-white/50 font-normal mt-1">
                    {visibleEps} of {episodes.length}
                  </span>
                </button>
              )}
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
          {!showSeasonPicker && isCollection && episodes.length > 3 && showEpisodesArrow && (
            <button
              onClick={scrollEpisodesForward}
              aria-label="More episodes"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black flex items-center justify-center"
            >
              <ChevronRight size={22} className="text-white" />
            </button>
          )}
        </div>
      </div>
      {showBannerPicker && (
        <HeroBannerPicker movie={movie} onClose={() => setShowBannerPicker(false)} />
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
      <div className="legacy-media relative">
        <SmartImage
          src={first ? movieImageSources(first) : undefined}
          alt={`Season ${season.seasonNumber}`}
          loading="lazy"
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
  fallbackMovie,
  canDelete = false,
  onDelete,
}: {
  movie: Movie;
  index: number;
  current?: boolean;
  onPlay: () => void;
  onSelect: () => void;
  fallbackMovie?: Movie;
  canDelete?: boolean;
  onDelete?: (movie: Movie) => void;
}) {
  const ownArt = movieImageSources(movie).filter((source) => source !== FALLBACK_THUMBNAIL);
  const seriesArt = (fallbackMovie ? movieImageSources(fallbackMovie) : []).filter(
    (source) => source !== FALLBACK_THUMBNAIL,
  );
  const episodeHasOwnArt = !!movie.youtubeId || !isGenericPoster(movie.image);
  const imageSources = episodeHasOwnArt
    ? [...ownArt, ...seriesArt, FALLBACK_THUMBNAIL]
    : [...seriesArt, ...ownArt, FALLBACK_THUMBNAIL];

  return (
    <div
      className="group relative shrink-0 w-64 cursor-pointer cv-card"
      onClick={current ? onPlay : onSelect}
      tabIndex={0}
      role="button"
      aria-label={movie.title}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          if (current) onPlay();
          else onSelect();
        }
      }}
    >
      <div className="legacy-media relative rounded-lg overflow-hidden bg-white/5">
        <SmartImage
          src={imageSources}
          alt={movie.title}
          loading="lazy"
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
          {canDelete && onDelete && (
            <button
              className="w-7 h-7 rounded-md bg-red-600/70 hover:bg-red-600 flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete episode "${movie.title}"? This cannot be undone.`)) {
                  onDelete(movie);
                }
              }}
              title="Delete episode"
              aria-label={`Delete episode ${movie.title}`}
            >
              <Trash2 size={13} className="text-white" />
            </button>
          )}
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
            <p className="text-white/60 text-[11px] mt-0.5 line-clamp-1">{movie.description}</p>
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
  const isTv = useIsTvBrowser();
  return (
    <div
      className="group relative shrink-0 w-56 cursor-pointer cv-card"
      onClick={onSelect}
      tabIndex={0}
      role="button"
      aria-label={movie.title}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="legacy-media relative rounded-lg overflow-hidden bg-white/5">
        <SmartImage
          src={movieImageSources(movie)}
          alt={movie.title}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className={`absolute inset-0 m-auto w-11 h-11 rounded-full bg-[#f47521]/90 hover:bg-[#f47521] flex items-center justify-center transition-opacity ${
            isTv ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Play size={16} fill="white" className="text-white ml-0.5" />
        </button>
        <div className="absolute left-0 right-0 bottom-0 px-3 pb-2">
          <h4 className="text-white text-sm font-semibold truncate">{movie.title}</h4>
          <p className="text-white/50 text-[11px]">
            {movie.year} • {movie.rating}
          </p>
        </div>
      </div>
    </div>
  );
}
