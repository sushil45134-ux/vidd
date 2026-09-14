import { useState, useCallback, useEffect, useMemo, lazy, Suspense, type ReactNode } from "react";
import Navbar from "./components/Navbar";
import HeroBanner from "./components/HeroBanner";
import MovieRow from "./components/MovieRow";
import SearchResults from "./components/SearchResults";
import SmartImage from "./components/SmartImage";
import { useVisibleCount } from "./lib/useVisibleCount";
import ContinueWatchingRow from "./components/ContinueWatchingRow";

// View-specific panels load with their view — the home feed never pays for
// them (keeps the eager routes chunk, and therefore first paint, small).
const NotificationPanel = lazy(() => import("./components/NotificationPanel"));
const UnifiedSearch = lazy(() => import("./components/UnifiedSearch"));
const AnimeSection = lazy(() => import("./components/AnimeSection"));

// Heavy modals / overlays — loaded on demand to keep the initial bundle small.
const MovieModal = lazy(() => import("./components/MovieModal"));
const PlayerOverlay = lazy(() => import("./components/PlayerOverlay"));
const UploadModal = lazy(() => import("./components/UploadModal"));
const PlaylistSync = lazy(() => import("./components/PlaylistSync"));
const AiAssistant = lazy(() => import("./components/AiAssistant"));
const AdminRowsEditor = lazy(() => import("./components/AdminRowsEditor"));
const ThumbnailEditor = lazy(() => import("./components/ThumbnailEditor"));

import type { Movie, Category } from "./data";
import { getMovieRef, useSiteConfig, type CustomRow, type RowKey } from "./lib/customization";
import {
  getSavedProgress,
  markWatchFinished,
  removeContinueWatching,
  removeContinueWatchingForMovie,
  saveWatchProgress,
  useContinueWatching,
} from "./lib/continueWatching";
import { resolvePlannedSlots, type RowSlot } from "./lib/plannedRows";
import { purgeLegacyMovieCaches, readMoviesCache, writeMoviesCache } from "./lib/moviesCache";
import { isTvBrowser } from "./lib/browser";
import { useHeroBanners } from "./lib/heroBanners";
import { isGenericPoster, movieImageSources } from "./lib/media";
import { useCollectionCovers, setCollectionCover } from "./lib/collectionCovers";

// Start downloading the data layer (moviesRepo + the Supabase SDK chunk it
// depends on) at module-eval time — i.e. the moment the entry script runs,
// long before React hydrates and the mount effect would otherwise trigger the
// dynamic import. On slow phone/TV networks this overlaps one serialized
// chunk roundtrip with the framework boot, so the first Supabase query starts
// noticeably earlier.
const moviesRepoPromise: Promise<typeof import("./lib/moviesRepo")> = import("./lib/moviesRepo");

// Evaluated once — the UA never changes at runtime, and the category grid
// below used to re-run the regex for every card of every render.
const IS_TV = isTvBrowser();

const CATEGORY_MATCH: Record<string, (m: Movie) => boolean> = {
  anime: (m) => m.genre.some((g) => g.toLowerCase() === "anime"),
  cartoon: (m) => m.genre.some((g) => g.toLowerCase() === "cartoon"),
  movies: (m) => !m.genre.some((g) => ["anime", "cartoon"].includes(g.toLowerCase())),
};

/**
 * Group flat episode rows that share a playlistId into one series collection
 * (Crunchyroll-style) with seasons sorted by season/episode number. Rows
 * without a playlistId pass through untouched.
 */
function buildCollections(movies: Movie[], covers: Record<string, string>): Movie[] {
  const groups = new Map<string, Movie[]>();
  movies.forEach((m) => {
    if (!m.playlistId) return;
    if (!groups.has(m.playlistId)) groups.set(m.playlistId, []);
    groups.get(m.playlistId)!.push(m);
  });
  if (groups.size === 0) return movies;

  const emitted = new Set<string>();
  const out: Movie[] = [];
  movies.forEach((m) => {
    if (!m.playlistId) {
      out.push(m);
      return;
    }
    if (emitted.has(m.playlistId)) return;
    emitted.add(m.playlistId);
    const eps = groups.get(m.playlistId)!;
    const seasonMap = new Map<number, Movie[]>();
    eps.forEach((e) => {
      const s = e.seasonNumber || 1;
      if (!seasonMap.has(s)) seasonMap.set(s, []);
      seasonMap.get(s)!.push(e);
    });
    const coverOverride = covers[m.playlistId];
    const paintCover = (episode: Movie): Movie => {
      if (!coverOverride) return episode;
      // Keep real per-episode artwork (YouTube thumbs, custom stills). Only
      // replace the shared Pexels film-strip / empty poster so the series
      // cover shows on every episode card and in the modal hero.
      if (episode.youtubeId) return episode;
      if (!isGenericPoster(episode.image) && !isGenericPoster(episode.thumbnailUrl)) return episode;
      return {
        ...episode,
        image: coverOverride,
        thumbnailUrl: coverOverride,
        backdrop: isGenericPoster(episode.backdrop) ? coverOverride : episode.backdrop,
      };
    };
    const seasons = Array.from(seasonMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, seasonEps]) => ({
        seasonNumber,
        episodes: [...seasonEps]
          .sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0))
          .map(paintCover),
      }));
    const flatEps = seasons.flatMap((s) => s.episodes);
    const first = flatEps[0];
    let hash = 0;
    for (let i = 0; i < m.playlistId.length; i++)
      hash = (hash * 31 + m.playlistId.charCodeAt(i)) | 0;
    out.push({
      ...first,
      id: Math.abs(hash) + 1_000_000_000,
      title: first.playlistTitle || first.title,
      description: `${seasons.length > 1 ? `${seasons.length} seasons • ` : ""}${flatEps.length} episode${flatEps.length !== 1 ? "s" : ""}`,
      isCollection: true,
      episodes: flatEps,
      seasons,
      ...(coverOverride
        ? { image: coverOverride, thumbnailUrl: coverOverride, backdrop: coverOverride }
        : {}),
    });
  });
  return out;
}

/**
 * Merge two collection cards that share a playlistId into one. Used when the
 * admin adds more episodes (or a new season) to an existing series — instead
 * of a duplicate card, the new episodes join the existing card and its
 * seasons are rebuilt and re-sorted.
 */
function mergeCollection(existing: Movie, incoming: Movie): Movie {
  const combined = [...(existing.episodes || []), ...(incoming.episodes || [])];
  const seen = new Set<number>();
  const unique = combined.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  const rebuilt = buildCollections(unique, {});
  return rebuilt.find((m) => m.isCollection && m.playlistId === existing.playlistId) || incoming;
}

/**
 * Placeholder for a content row while the library is loading. Mirrors the
 * MovieRow footprint so nothing jumps when real cards arrive.
 */
function RowSkeleton({ large = false }: { large?: boolean }) {
  const w = large ? "w-[280px] md:w-[360px]" : "w-[220px] md:w-[300px]";
  return (
    <div className="relative px-4 md:px-12 mb-8">
      <div className="h-5 md:h-6 w-40 md:w-56 mb-3 rounded bg-white/10 animate-pulse" />
      <div className="flex gap-1.5 overflow-hidden py-1">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${w} shrink-0`}>
            <div className="aspect-video rounded-md bg-white/10 animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-white/5 mt-2 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Instant tap feedback while the details-modal / player chunk is still on
 * the wire (slow networks). Without it the tap looks dead until the chunk
 * lands — which reads as "site ruk gaya" rather than "loading".
 */
function OverlayFallback() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85">
      <div className="flex flex-col items-center gap-3">
        <div className="w-11 h-11 rounded-full border-[3px] border-white/15 border-t-[#f47521] animate-spin" />
        <p className="text-white/50 text-xs font-semibold tracking-wide">Loading…</p>
      </div>
    </div>
  );
}

function App() {
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [playingMovie, setPlayingMovie] = useState<Movie | null>(null);
  const [resumeAt, setResumeAt] = useState(0);
  const [myList, setMyList] = useState<Movie[]>([]);
  const [likedMovies, setLikedMovies] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  // Filter/render on the debounced value so every keystroke doesn't refilter
  // 2000+ titles and rebuild the results grid (the input itself stays live).
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 120);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const [activeCategory, setActiveCategory] = useState<Category>("home");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showPlaylistSync, setShowPlaylistSync] = useState(false);
  const [showAiAssistant, setShowAiAssistant] = useState(false);
  const [showAdminEditor, setShowAdminEditor] = useState(false);
  const [thumbnailEditMovie, setThumbnailEditMovie] = useState<Movie | null>(null);

  const [uploadedMovies, setUploadedMovies] = useState<Movie[]>([]);
  const [syncedMovies, setSyncedMovies] = useState<Movie[]>([]);
  const [animeEpisodes, setAnimeEpisodes] = useState<Movie[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  // True once the first library fetch settled (or the localStorage cache
  // already hydrated content). Until then the empty library must look like
  // "loading", never like a broken "No videos yet" site.
  const libraryLoaded =
    uploadedMovies.length > 0 || syncedMovies.length > 0 || animeEpisodes.length > 0;
  const [libraryFetchSettled, setLibraryFetchSettled] = useState(false);
  const showLibrarySkeleton = !libraryLoaded && !libraryFetchSettled;
  const cfg = useSiteConfig();
  const heroBannerOverrides = useHeroBanners();
  const collectionCovers = useCollectionCovers();

  const rowMeta = (key: RowKey) => {
    const r = cfg.rows.find((x) => x.key === key);
    return { title: r?.title ?? "", visible: r?.visible ?? true };
  };

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.isAdmin === true))
      .catch(() => {});
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch {}
    setIsAdmin(false);
  }, []);

  // Library fetch with retry. A stalled/blocked network used to look exactly
  // like an empty library (planned rows went full "Coming Soon", the hero
  // said "No videos yet") with no way to recover short of a page reload —
  // now a failed fetch raises an honest Retry banner instead.
  const [libraryError, setLibraryError] = useState(false);
  const loadLibrary = useCallback(() => {
    moviesRepoPromise
      .then(({ fetchAllMovies }) =>
        fetchAllMovies(undefined, (partial) => {
          // First page is in — paint the hero/rows now; remaining pages land
          // in the final .then below.
          setUploadedMovies(partial.uploaded);
          setSyncedMovies(partial.synced);
        }),
      )
      .then(({ uploaded, synced, failed }) => {
        setUploadedMovies(uploaded);
        setSyncedMovies(synced);
        setLibraryFetchSettled(true);
        setLibraryError(failed && uploaded.length === 0 && synced.length === 0);
        // The cache is trimmed to the newest rows (see moviesCache.ts), so
        // writing it stays cheap even for a 4,000+ row library.
        const writeCache = () => {
          writeMoviesCache(uploaded, synced);
        };
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(writeCache, { timeout: 2000 });
        } else {
          setTimeout(writeCache, 0);
        }
      })
      .catch(() => {
        // Offline or Supabase error — the cache (if any) is already showing;
        // swap the loading skeleton for the real empty state.
        setLibraryFetchSettled(true);
        setLibraryError(true);
      });
  }, []);

  // Load movies from Supabase on mount — hydrate from cache first for instant paint
  useEffect(() => {
    // Drop multi-megabyte caches from older builds (they caused the boot lag).
    purgeLegacyMovieCaches();
    const cached = readMoviesCache();
    if (cached) {
      setUploadedMovies(cached.uploaded);
      setSyncedMovies(cached.synced);
    }

    loadLibrary();

    // Warm on-demand modal/player chunks when idle so first open is instant.
    // Also warm on the very first interaction (pointer/key) — on slow
    // networks idle may never fire before the first tap, and an unwarm
    // chunk is exactly the "tap a movie, nothing happens" report.
    let warmed = false;
    const warmOverlays = () => {
      if (warmed) return;
      warmed = true;
      import("./components/MovieModal").catch(() => {});
      import("./components/PlayerOverlay").catch(() => {});
    };
    const warmOnInteract = () => warmOverlays();
    window.addEventListener("pointerdown", warmOnInteract, { once: true, capture: true });
    window.addEventListener("keydown", warmOnInteract, { once: true, capture: true });
    window.addEventListener("touchstart", warmOnInteract, { once: true, capture: true });
    if (typeof requestIdleCallback !== "undefined") {
      const idleId = requestIdleCallback(warmOverlays, { timeout: 3000 });
      return () => {
        cancelIdleCallback(idleId);
        window.removeEventListener("pointerdown", warmOnInteract, { capture: true });
        window.removeEventListener("keydown", warmOnInteract, { capture: true });
        window.removeEventListener("touchstart", warmOnInteract, { capture: true });
      };
    }
    const t = setTimeout(warmOverlays, 2000);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", warmOnInteract, { capture: true });
      window.removeEventListener("keydown", warmOnInteract, { capture: true });
      window.removeEventListener("touchstart", warmOnInteract, { capture: true });
    };
  }, [loadLibrary]);

  const retryLibrary = useCallback(() => {
    setLibraryError(false);
    setLibraryFetchSettled(false);
    loadLibrary();
  }, [loadLibrary]);

  const allMovies = useMemo(
    () => [...uploadedMovies, ...syncedMovies],
    [uploadedMovies, syncedMovies],
  );

  // Group episodes (synced playlists AND user-uploaded series) into
  // playlist collections (Crunchyroll-style)
  const syncedCollections = useMemo(
    () => buildCollections(syncedMovies, collectionCovers),
    [syncedMovies, collectionCovers],
  );
  const uploadedCollections = useMemo(
    () => buildCollections(uploadedMovies, collectionCovers),
    [uploadedMovies, collectionCovers],
  );

  // What we show in rows / categories (collections instead of individual episodes)
  const displayItems = useMemo(
    () => [...uploadedCollections, ...syncedCollections],
    [uploadedCollections, syncedCollections],
  );

  // Continue Watching — stored snapshots reconciled with fresh library data.
  const continueWatchingLibrary = useMemo(
    () => [...allMovies, ...animeEpisodes],
    [allMovies, animeEpisodes],
  );
  const continueWatchingItems = useContinueWatching(continueWatchingLibrary);

  // "More info" from the Continue Watching row opens the series modal for
  // episodes (so seasons / episode lists stay one tap away).
  const openResumeDetails = useCallback(
    (movie: Movie) => {
      if (movie.playlistId) {
        const collection = displayItems.find(
          (m) =>
            m.isCollection &&
            (m.playlistId === movie.playlistId || m.episodes?.[0]?.playlistId === movie.playlistId),
        );
        if (collection) {
          setSelectedMovie(collection);
          return;
        }
      }
      setSelectedMovie(movie);
    },
    [displayItems],
  );

  const resolveCustomRowItems = useCallback(
    (row: CustomRow) => {
      const byId = new Map(displayItems.map((movie) => [movie.id, movie]));
      const byRef = new Map(displayItems.map((movie) => [getMovieRef(movie), movie]));
      const byEpisodeId = new Map<number, Movie>();
      displayItems.forEach((movie) => {
        movie.episodes?.forEach((episode) => byEpisodeId.set(episode.id, movie));
      });
      const used = new Set<number>();
      const items: Movie[] = [];
      const push = (movie?: Movie) => {
        if (!movie || used.has(movie.id)) return;
        used.add(movie.id);
        items.push(movie);
      };
      (row.movieRefs || []).forEach((ref) => push(byRef.get(ref)));
      row.movieIds.forEach((id) => push(byId.get(id) || byEpisodeId.get(id)));
      return items;
    },
    [displayItems],
  );

  // Planned (wishlist) rows resolve by title and keep a "Coming Soon" slot
  // for every missing title; manual rows behave exactly as before.
  const resolveRowSlots = useCallback(
    (row: CustomRow): RowSlot[] => {
      const planned = (row.plannedTitles || []).map((t) => t.trim()).filter(Boolean);
      if (planned.length > 0) return resolvePlannedSlots(planned, displayItems);
      return resolveCustomRowItems(row).map((movie) => ({ kind: "movie" as const, movie }));
    },
    [displayItems, resolveCustomRowItems],
  );

  // Per-row slots memoized as a whole: each row's array keeps its identity
  // across unrelated renders, so memo()'d rows below skip re-rendering.
  const rowSlotsById = useMemo(() => {
    const map = new Map<string, RowSlot[]>();
    cfg.customRows?.forEach((row) => {
      map.set(row.id, resolveRowSlots(row));
    });
    return map;
  }, [cfg.customRows, resolveRowSlots]);

  const existingYtIds = useMemo(() => {
    const ids = new Set<string>();
    allMovies.forEach((m) => {
      if (m.youtubeId) ids.add(m.youtubeId);
    });
    return ids;
  }, [allMovies]);

  // Existing uploaded series (for "Add to Existing Series" in the upload flow).
  const existingSeries = useMemo(() => {
    const map = new Map<string, { title: string; seasons: Map<number, number> }>();
    uploadedMovies.forEach((m) => {
      if (!m.playlistId) return;
      const entry = map.get(m.playlistId) || {
        title: m.playlistTitle || "Series",
        seasons: new Map<number, number>(),
      };
      const s = m.seasonNumber || 1;
      entry.seasons.set(s, (entry.seasons.get(s) || 0) + 1);
      map.set(m.playlistId, entry);
    });
    return Array.from(map.entries()).map(([playlistId, { title, seasons }]) => ({
      playlistId,
      title,
      seasons: [...seasons.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([season, count]) => ({ season, count })),
    }));
  }, [uploadedMovies]);

  const handlePlaylistSync = useCallback(async (movies: Movie[]) => {
    setShowPlaylistSync(false);
    const { insertMovies } = await import("./lib/moviesRepo");
    const saved = await insertMovies(movies, "synced");
    const toAdd = saved.length > 0 ? saved : movies;
    setSyncedMovies((prev) => [...toAdd, ...prev]);
  }, []);

  const toggleMyList = useCallback((movie: Movie) => {
    setMyList((prev) => {
      const exists = prev.find((m) => m.id === movie.id);
      if (exists) return prev.filter((m) => m.id !== movie.id);
      return [movie, ...prev];
    });
  }, []);

  const toggleLike = useCallback((movieId: number) => {
    setLikedMovies((prev) => {
      const next = new Set(prev);
      if (next.has(movieId)) next.delete(movieId);
      else next.add(movieId);
      return next;
    });
  }, []);

  const isInMyList = useCallback(
    (movieId: number) => myList.some((m) => m.id === movieId),
    [myList],
  );
  const isLiked = useCallback((movieId: number) => likedMovies.has(movieId), [likedMovies]);

  // Lowercased search blob per title, built once per library change — every
  // keystroke then costs one `includes` per title instead of re-lowercasing
  // five fields per title (GC churn that stuttered typing on phones/TVs).
  const searchIndex = useMemo(
    () =>
      displayItems.map((movie) => ({
        movie,
        blob: (
          movie.title +
          " " +
          movie.genre.join(" ") +
          " " +
          movie.description +
          " " +
          (movie.cast ? movie.cast.join(" ") : "") +
          " " +
          (movie.creator || "")
        ).toLowerCase(),
      })),
    [displayItems],
  );

  const searchResults = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const q = debouncedQuery.toLowerCase();
    const out: Movie[] = [];
    for (const entry of searchIndex) {
      if (entry.blob.includes(q)) out.push(entry.movie);
    }
    return out;
  }, [debouncedQuery, searchIndex]);

  // IDs claimed by visible custom rows (every section): titles placed in a
  // row never repeat in the auto grid below. Read straight from the already
  // memoized rowSlotsById — re-resolving every row here used to re-run the
  // whole planned-title match a second time per render pass.
  const placedIds = useMemo(() => {
    const ids = new Set<number>();
    if (!cfg.customRows) return ids;
    for (const row of cfg.customRows) {
      if (!row.visible) continue;
      const slots = rowSlotsById.get(row.id);
      if (!slots) continue;
      for (const slot of slots) {
        if (slot.kind !== "movie") continue;
        ids.add(slot.movie.id);
        slot.movie.episodes?.forEach((e) => ids.add(e.id));
      }
    }
    return ids;
  }, [cfg.customRows, rowSlotsById]);

  const getCategoryMovies = useCallback(() => {
    if (activeCategory === "mylist") return myList;
    const matcher = CATEGORY_MATCH[activeCategory];
    if (!matcher) return [];
    // A title placed in ANY visible custom row (any section, manual or
    // planned) shows only in its row — never again in the auto grid below.
    return displayItems.filter((m) => matcher(m) && !placedIds.has(m.id));
  }, [activeCategory, myList, displayItems, placedIds]);

  // Computed once per data change instead of on every render pass.
  const categoryMovies = useMemo(() => getCategoryMovies(), [getCategoryMovies]);
  const { visible: gridVisible, showMore: showMoreGrid } = useVisibleCount(activeCategory);

  const handlePlay = useCallback((movie: Movie, opts?: { fromStart?: boolean }) => {
    setSelectedMovie(null);
    // Auto-resume: any saved progress for this exact video is picked up, no
    // matter which row / modal / screen the Play press came from.
    setResumeAt(opts?.fromStart ? 0 : getSavedProgress(movie));
    setPlayingMovie(movie);
  }, []);

  // Stable "play first episode" for row cards (avoids inline arrows that
  // would defeat memo() on every render).
  const playFirstEpisode = useCallback(
    (m: Movie) => handlePlay(m.episodes?.[0] || m),
    [handlePlay],
  );

  // Continue Watching: throttled clock from the players (attributed to the
  // episode actually on screen by PlayerOverlay).
  const handleWatchProgress = useCallback(
    (movie: Movie, currentSec: number, durationSec: number) => {
      saveWatchProgress(movie, currentSec, durationSec);
    },
    [],
  );
  const handleWatchEnded = useCallback((movie: Movie) => {
    markWatchFinished(movie);
  }, []);

  // Stable so AnimeSection's effect doesn't re-fire on every render.
  const handleAnimeEpisodesLoaded = useCallback((episodes: Movie[]) => {
    setAnimeEpisodes(episodes);
  }, []);

  // Stable identity (the TV back-stack relies on mount-time registration).
  const closeModal = useCallback(() => setSelectedMovie(null), []);
  const closePlayer = useCallback(() => setPlayingMovie(null), []);
  const closeNotifications = useCallback(() => setShowNotifications(false), []);

  // Stable Navbar/HeroBanner callbacks — inline arrows here would defeat
  // memo() on those components and re-render them on every App render
  // (including every modal open and every playback-progress tick).
  const handleCategoryChange = useCallback((cat: Category) => {
    setActiveCategory(cat);
    setSearchQuery("");
  }, []);
  const handleNotificationToggle = useCallback(() => setShowNotifications((v) => !v), []);
  const handleUploadOpen = useCallback(() => setShowUploadModal(true), []);
  const handleSyncOpen = useCallback(() => setShowPlaylistSync(true), []);
  const handleAiOpen = useCallback(() => setShowAiAssistant(true), []);
  const handleCustomizeOpen = useCallback(() => setShowAdminEditor(true), []);

  const handleUpload = useCallback(
    async (movies: Movie | Movie[], opts?: { autoplay?: boolean }) => {
      const arr = Array.isArray(movies) ? movies : [movies];
      setShowUploadModal(false);
      const { insertMovies } = await import("./lib/moviesRepo");
      const saved = await insertMovies(arr, "uploaded");
      const toAdd = saved.length > 0 ? saved : arr;
      setUploadedMovies((prev) => [...toAdd, ...prev]);
      // Series uploads (episodes sharing a playlistId) belong in My List as ONE
      // collection card, not as a separate "Episode 1/2/3" card per episode.
      const grouped = buildCollections(toAdd, {});
      setMyList((prev) => {
        const next = [...prev];
        for (const item of grouped) {
          const idx = next.findIndex(
            (m) => m.isCollection && m.playlistId && m.playlistId === item.playlistId,
          );
          // Adding episodes to an existing series merges into its card instead
          // of creating a duplicate.
          if (idx >= 0) next[idx] = mergeCollection(next[idx], item);
          else next.unshift(item);
        }
        return next;
      });
      if (opts?.autoplay !== false) setTimeout(() => setPlayingMovie(toAdd[0]), 500);
    },
    [],
  );

  // Admin-only: delete an uploaded video, a single synced video, or a whole
  // synced playlist (collection). Removes it from every list it lives in.
  const handleDelete = useCallback(
    async (movie: Movie) => {
      // Whole playlist collection: drop every synced episode sharing the playlistId.
      if (movie.isCollection && movie.episodes && movie.episodes.length > 0) {
        removeContinueWatchingForMovie(movie);
        const pid = movie.episodes[0].playlistId;
        const epIds = new Set(movie.episodes.map((e) => e.id));
        const { deleteMovieById, deleteMoviesByPlaylist } = await import("./lib/moviesRepo");
        if (pid) {
          await deleteMoviesByPlaylist(pid);
        } else {
          await Promise.all(movie.episodes.map((e) => deleteMovieById(e.id)));
        }
        setSyncedMovies((prev) =>
          prev.filter((m) => (pid ? m.playlistId !== pid : !epIds.has(m.id))),
        );
        setUploadedMovies((prev) =>
          prev.filter((m) => (pid ? m.playlistId !== pid : !epIds.has(m.id))),
        );
        setMyList((prev) => prev.filter((m) => m.id !== movie.id && !epIds.has(m.id)));
        setLikedMovies((prev) => {
          const next = new Set(prev);
          next.delete(movie.id);
          epIds.forEach((id) => next.delete(id));
          return next;
        });
        return;
      }
      // Single item (uploaded or standalone synced).
      removeContinueWatchingForMovie(movie);
      const { deleteMovieById } = await import("./lib/moviesRepo");
      await deleteMovieById(movie.id);
      setUploadedMovies((prev) => prev.filter((m) => m.id !== movie.id));
      setSyncedMovies((prev) => prev.filter((m) => m.id !== movie.id));
      setMyList((prev) => prev.filter((m) => m.id !== movie.id));
      setSelectedMovie((prev) => {
        if (!prev?.isCollection || !prev.episodes) return prev;
        const remainingEpisodes = prev.episodes.filter((episode) => episode.id !== movie.id);
        if (remainingEpisodes.length === prev.episodes.length) return prev;
        if (remainingEpisodes.length === 0) return null;

        // Keep an open series modal in sync as well as the cards behind it. The
        // source lists above trigger the normal buildCollections re-run, while
        // this rebuild prevents the stale selectedMovie snapshot from showing
        // the deleted episode until the modal is closed.
        return (
          buildCollections(remainingEpisodes, collectionCovers).find(
            (item) => item.isCollection && item.playlistId === prev.playlistId,
          ) || prev
        );
      });
      setLikedMovies((prev) => {
        const next = new Set(prev);
        next.delete(movie.id);
        return next;
      });
    },
    [collectionCovers],
  );

  // Admin-only: replace an existing item's displayed thumbnail image.
  // For collections (series), the cover is saved to Supabase first and only
  // then mirrored into local cache/UI. That prevents a local-only fake update
  // that disappears on phones or another Chrome profile. No episode row in the
  // DB is touched, so every episode thumbnail stays exactly as it was.
  const handleUpdateThumbnail = useCallback(async (target: Movie, newUrl: string) => {
    const isCollection = !!(target.isCollection && target.episodes?.length);
    const syntheticId = target.id;

    if (isCollection) {
      const playlistId = target.episodes?.[0]?.playlistId;
      if (!playlistId) return;
      const saved = await setCollectionCover(playlistId, newUrl);
      if (!saved) {
        alert(
          "Series cover Supabase mein save nahi hua. Kripya collection_covers table ki RLS/GRANT policy check karo, phir dobara try karo.",
        );
        return;
      }
      const paint = (episode: Movie): Movie => {
        if (episode.youtubeId) return episode;
        if (!isGenericPoster(episode.image) && !isGenericPoster(episode.thumbnailUrl))
          return episode;
        return { ...episode, image: newUrl, thumbnailUrl: newUrl, backdrop: newUrl };
      };
      setSelectedMovie((prev) =>
        prev && prev.id === syntheticId
          ? {
              ...prev,
              image: newUrl,
              thumbnailUrl: newUrl,
              backdrop: newUrl,
              episodes: prev.episodes?.map(paint),
              seasons: prev.seasons?.map((season) => ({
                ...season,
                episodes: season.episodes.map(paint),
              })),
            }
          : prev,
      );
      setThumbnailEditMovie((prev) =>
        prev && prev.id === syntheticId
          ? { ...prev, image: newUrl, thumbnailUrl: newUrl, backdrop: newUrl }
          : prev,
      );
      return;
    }

    const dbId = target.id;
    const patch = (m: Movie): Movie =>
      m.id === dbId ? { ...m, image: newUrl, thumbnailUrl: newUrl, backdrop: newUrl } : m;
    const { updateMovieThumbnail } = await import("./lib/moviesRepo");
    const saved = await updateMovieThumbnail(dbId, newUrl);
    if (!saved) {
      alert(
        "Poster public website par save nahi hua. Supabase movies table ki RLS/GRANT policy check karo, phir dobara try karo.",
      );
      return;
    }
    let nextUploaded: Movie[] = [];
    let nextSynced: Movie[] = [];
    setUploadedMovies((prev) => (nextUploaded = prev.map(patch)));
    setSyncedMovies((prev) => (nextSynced = prev.map(patch)));
    setMyList((prev) => prev.map(patch));
    setSelectedMovie((prev) =>
      prev && prev.id === dbId
        ? { ...prev, image: newUrl, thumbnailUrl: newUrl, backdrop: newUrl }
        : prev,
    );
    setThumbnailEditMovie((prev) =>
      prev && prev.id === dbId
        ? { ...prev, image: newUrl, thumbnailUrl: newUrl, backdrop: newUrl }
        : prev,
    );
    writeMoviesCache(nextUploaded, nextSynced);
  }, []);

  const showingSearch = debouncedQuery.trim().length > 0;
  const showingDiscover = activeCategory === "discover" && !showingSearch;
  const showingCategory =
    activeCategory !== "home" && activeCategory !== "discover" && !showingSearch;
  // While the library is in flight, admin rows must show skeletons — NOT a
  // wall of "Coming Soon" placeholders (planned rows can't know yet which
  // titles are genuinely missing, and on a stalled network that wall used to
  // sit there forever looking broken). While the fetch has FAILED with an
  // empty library, rows stay hidden entirely — the Retry banner explains why
  // nothing is showing.
  const libraryMissing = !libraryLoaded;
  const showRowSkeletons = showLibrarySkeleton || (libraryError && libraryMissing);

  // Series queue for the player, memoized: the inline filter+sort over the
  // whole library used to re-run on EVERY App render while the player was
  // open (including each Continue Watching progress tick).
  const playerEpisodes = useMemo(() => {
    const pid = playingMovie?.playlistId;
    if (!playingMovie || !pid) return undefined;
    const sortByEp = (a: Movie, b: Movie) =>
      (a.seasonNumber || 1) - (b.seasonNumber || 1) ||
      (a.episodeNumber || 0) - (b.episodeNumber || 0);
    const pick = (list: Movie[]) => {
      const siblings = list.filter((m) => m.playlistId === pid).sort(sortByEp);
      return siblings.length > 1 ? siblings : undefined;
    };
    return pick(syncedMovies) ?? pick(uploadedMovies) ?? pick(animeEpisodes);
  }, [playingMovie, syncedMovies, uploadedMovies, animeEpisodes]);

  // Hero rotates through user's most recent content
  const heroMovies = useMemo<Movie[]>(() => {
    if (heroBannerOverrides.length > 0) {
      const resolved = heroBannerOverrides
        .map((h) => {
          const base = displayItems.find((m) => m.id === h.movieId);
          if (!base) return null;
          return {
            ...base,
            title: h.title || base.title,
            description: h.description || base.description,
            backdrop: h.bannerImage,
            image: h.bannerImage,
          } as Movie;
        })
        .filter((m): m is Movie => !!m);
      if (resolved.length > 0) return resolved;
    }
    return displayItems.slice(0, 5);
  }, [heroBannerOverrides, displayItems]);

  return (
    <div className="bg-black min-h-screen text-white">
      <Navbar
        onSearch={setSearchQuery}
        searchQuery={searchQuery}
        activeCategory={activeCategory}
        onCategoryChange={handleCategoryChange}
        onNotificationClick={handleNotificationToggle}
        showNotifications={showNotifications}
        onUploadClick={handleUploadOpen}
        onSyncClick={handleSyncOpen}
        onAiClick={handleAiOpen}
        onCustomizeClick={handleCustomizeOpen}
        isAdmin={isAdmin}
        onLogout={handleLogout}
      />

      <main className="pt-16">
        {libraryError && (
          <div className="mx-4 md:mx-12 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <span className="text-sm text-red-200">
              Library network se load nahi ho payi — content isliye nahi dikh raha.
            </span>
            <button
              onClick={retryLibrary}
              className="ml-auto h-9 px-4 rounded-full bg-red-500/80 hover:bg-red-500 text-white text-sm font-bold transition"
            >
              Retry
            </button>
          </div>
        )}

        {showNotifications && (
          <Suspense fallback={null}>
            <NotificationPanel
              onClose={closeNotifications}
              onMovieClick={(movie: Movie) => {
                setShowNotifications(false);
                setSelectedMovie(movie);
              }}
            />
          </Suspense>
        )}

        {showingSearch && (
          <SearchResults
            results={searchResults}
            query={debouncedQuery}
            onSelectMovie={setSelectedMovie}
            onPlay={playFirstEpisode}
            isInMyList={isInMyList}
            isLiked={isLiked}
            toggleMyList={toggleMyList}
            toggleLike={toggleLike}
          />
        )}

        {showingDiscover && (
          <Suspense
            fallback={
              <div className="px-4 md:px-12 pt-6">
                <div className="h-10 w-64 rounded bg-white/10 animate-pulse" />
              </div>
            }
          >
            <UnifiedSearch
              library={displayItems}
              onSelectMovie={setSelectedMovie}
              onPlay={handlePlay}
              onAdd={async (movie: Movie) => {
                const { insertMovies } = await import("./lib/moviesRepo");
                const saved = await insertMovies([movie], "uploaded");
                const toAdd = saved[0] ?? movie;
                setUploadedMovies((prev) => [toAdd, ...prev]);
                setMyList((prev) => [toAdd, ...prev]);
              }}
            />
          </Suspense>
        )}

        {showingCategory && (
          <div className="pt-6 min-h-screen">
            <h1 className="text-white text-2xl md:text-4xl font-bold mb-6 px-4 md:px-12">
              {activeCategory === "movies"
                ? "Movies"
                : activeCategory === "anime"
                  ? "Anime"
                  : activeCategory === "cartoon"
                    ? "Cartoon"
                    : activeCategory === "mylist"
                      ? "My List"
                      : activeCategory}
            </h1>

            {/* Hindi dubbed anime shelf (official licensed YouTube channels). */}
            {activeCategory === "anime" && (
              <Suspense
                fallback={
                  <div className="px-4 md:px-12 mb-8">
                    <div className="h-6 w-56 mb-3 rounded bg-white/10 animate-pulse" />
                    <div className="flex gap-2 overflow-hidden">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-[220px] md:w-[300px] shrink-0 aspect-video rounded-md bg-white/10 animate-pulse"
                        />
                      ))}
                    </div>
                  </div>
                }
              >
                <AnimeSection
                  onSelectMovie={setSelectedMovie}
                  onPlay={handlePlay}
                  isInMyList={isInMyList}
                  isLiked={isLiked}
                  toggleMyList={toggleMyList}
                  toggleLike={toggleLike}
                  onEpisodesLoaded={handleAnimeEpisodesLoaded}
                />
              </Suspense>
            )}

            {/* Admin custom rows scoped to this section */}
            {cfg.customRows?.map((row) => {
              if (!row.visible) return null;
              const sec = row.section || "home";
              if (sec !== "all" && sec !== activeCategory) return null;
              if (showRowSkeletons) return <RowSkeleton key={row.id} large={row.isLarge} />;
              const slots = rowSlotsById.get(row.id) || [];
              if (slots.length === 0) return null;
              return (
                <MovieRow
                  key={row.id}
                  title={row.title}
                  titleSize={row.titleSize}
                  slots={slots}
                  isLargeRow={row.isLarge}
                  onSelectMovie={setSelectedMovie}
                  onPlay={playFirstEpisode}
                  isInMyList={isInMyList}
                  isLiked={isLiked}
                  toggleMyList={toggleMyList}
                  toggleLike={toggleLike}
                  canDelete={isAdmin}
                  onDelete={handleDelete}
                  canEditThumbnail={isAdmin}
                  onEditThumbnail={setThumbnailEditMovie}
                />
              );
            })}

            <div className="px-4 md:px-12">
              {showLibrarySkeleton ? (
                <div className="tv-category-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Array.from({ length: 12 }, (_, i) => (
                    <div key={`skeleton-${i}`} className="cv-card animate-pulse">
                      <div className="legacy-media tv-card-media relative overflow-hidden rounded-md bg-gray-800" />
                      <div className="h-3 w-2/3 rounded bg-white/10 mt-2" />
                    </div>
                  ))}
                </div>
              ) : categoryMovies.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <p className="text-gray-400 text-lg">No titles found</p>
                  <p className="text-gray-600 text-sm mt-2">
                    {activeCategory === "mylist"
                      ? 'Add movies and shows to your list by clicking the "+" button'
                      : isAdmin
                        ? "Upload a video or sync a playlist to see content here"
                        : "Ask the admin to add content"}
                  </p>
                </div>
              ) : (
                <div className="tv-category-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {categoryMovies.slice(0, gridVisible).map((movie) => (
                    <div
                      key={movie.id}
                      className="tv-category-card cv-card group cursor-pointer"
                      onClick={() => setSelectedMovie(movie)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${movie.title} — open details`}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                          e.preventDefault();
                          setSelectedMovie(movie);
                        }
                      }}
                    >
                      <div className="legacy-media tv-card-media relative overflow-hidden rounded-md bg-gray-800">
                        <SmartImage
                          src={movieImageSources(movie)}
                          alt={movie.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                        />
                        <div
                          className={`absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center ${IS_TV ? "hidden" : ""}`}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlay(movie);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 w-12 h-12 rounded-full bg-white/90 flex items-center justify-center"
                          >
                            <svg
                              className="w-5 h-5 text-black ml-0.5"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <p className="text-gray-300 text-sm mt-2 truncate">{movie.title}</p>
                    </div>
                  ))}
                </div>
              )}
              {categoryMovies.length > gridVisible && (
                <div className="flex flex-col items-center gap-2 py-8">
                  <p className="text-gray-500 text-xs">
                    Showing {gridVisible} of {categoryMovies.length}
                  </p>
                  <button
                    onClick={showMoreGrid}
                    className="px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition"
                  >
                    Load more
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {!showingSearch && !showingCategory && !showingDiscover && (
          <>
            <HeroBanner
              movies={heroMovies}
              loading={showLibrarySkeleton || (libraryError && heroMovies.length === 0)}
              onMoreInfo={setSelectedMovie}
              onPlay={handlePlay}
              onUploadClick={handleUploadOpen}
              onSyncClick={handleSyncOpen}
              isAdmin={isAdmin}
            />

            <div className="mt-8 relative z-20">
              {/* Hindi dubbed anime lives ONLY in the "Anime" category tab —
                never mixed into the home feed. */}

              {/* Synced playlists no longer auto-appear on home.
                Admin adds them via Custom Rows when desired. */}

              {(() => {
                const elements: ReactNode[] = [];
                const pushContinueWatching = () => {
                  if (continueWatchingItems.length === 0) return;
                  elements.push(
                    <ContinueWatchingRow
                      key="continue-watching"
                      items={continueWatchingItems}
                      onPlay={handlePlay}
                      onSelectMovie={openResumeDetails}
                      onRemove={removeContinueWatching}
                    />,
                  );
                };
                let rowsRendered = false;
                cfg.customRows?.forEach((row) => {
                  if (!row.visible) return;
                  const sec = row.section || "home";
                  if (sec !== "home" && sec !== "all") return;
                  if (showRowSkeletons) {
                    elements.push(<RowSkeleton key={row.id} large={row.isLarge} />);
                    return;
                  }
                  const slots = rowSlotsById.get(row.id) || [];
                  if (slots.length === 0) return;
                  elements.push(
                    <MovieRow
                      key={row.id}
                      title={row.title}
                      titleSize={row.titleSize}
                      slots={slots}
                      isLargeRow={row.isLarge}
                      onSelectMovie={setSelectedMovie}
                      onPlay={playFirstEpisode}
                      isInMyList={isInMyList}
                      isLiked={isLiked}
                      toggleMyList={toggleMyList}
                      toggleLike={toggleLike}
                      canDelete={isAdmin}
                      onDelete={handleDelete}
                      canEditThumbnail={isAdmin}
                      onEditThumbnail={setThumbnailEditMovie}
                    />,
                  );
                  // Continue Watching sits right BELOW the first row
                  // (Trending & Popular Shows), never above it.
                  if (!rowsRendered) {
                    rowsRendered = true;
                    pushContinueWatching();
                  }
                });
                // No custom rows at all — Continue Watching still shows alone.
                if (!rowsRendered) pushContinueWatching();
                return elements;
              })()}
            </div>
          </>
        )}
      </main>

      <Suspense fallback={selectedMovie || playingMovie ? <OverlayFallback /> : null}>
        {selectedMovie && (
          <MovieModal
            movie={selectedMovie}
            onClose={closeModal}
            onPlay={handlePlay}
            isInMyList={isInMyList(selectedMovie.id)}
            isLiked={isLiked(selectedMovie.id)}
            onToggleMyList={() => toggleMyList(selectedMovie)}
            onToggleLike={() => toggleLike(selectedMovie.id)}
            onSelectMovie={setSelectedMovie}
            allMovies={allMovies}
            canDelete={isAdmin}
            onDelete={handleDelete}
            canEditThumbnail={isAdmin}
            onEditThumbnail={setThumbnailEditMovie}
          />
        )}

        {showUploadModal && (
          <UploadModal
            onClose={() => setShowUploadModal(false)}
            onUpload={handleUpload}
            existingSeries={existingSeries}
          />
        )}

        {showPlaylistSync && (
          <PlaylistSync
            onClose={() => setShowPlaylistSync(false)}
            onSync={handlePlaylistSync}
            existingIds={existingYtIds}
          />
        )}

        {showAiAssistant && (
          <AiAssistant onClose={() => setShowAiAssistant(false)} onAdd={handleUpload} />
        )}

        {showAdminEditor && (
          <AdminRowsEditor
            onClose={() => setShowAdminEditor(false)}
            availableMovies={displayItems}
            onAddMovies={(movies) => handleUpload(movies, { autoplay: false })}
          />
        )}

        {thumbnailEditMovie && (
          <ThumbnailEditor
            movie={thumbnailEditMovie}
            onClose={() => setThumbnailEditMovie(null)}
            onSave={(url) => handleUpdateThumbnail(thumbnailEditMovie, url)}
          />
        )}

        {playingMovie && (
          <PlayerOverlay
            movie={playingMovie}
            onClose={closePlayer}
            startAt={resumeAt}
            onProgress={handleWatchProgress}
            onEnded={handleWatchEnded}
            episodes={playerEpisodes}
          />
        )}
      </Suspense>
    </div>
  );
}

export default App;
