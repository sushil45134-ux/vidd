import { useState, useCallback, useEffect, useMemo, lazy, Suspense, type ReactNode } from "react";
import Navbar from "./components/Navbar";
import HeroBanner from "./components/HeroBanner";
import MovieRow from "./components/MovieRow";
import NotificationPanel from "./components/NotificationPanel";
import SearchResults from "./components/SearchResults";
import UnifiedSearch from "./components/UnifiedSearch";
import SmartImage from "./components/SmartImage";
import AnimeSection from "./components/AnimeSection";
import ContinueWatchingRow from "./components/ContinueWatchingRow";

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
import { isTvBrowser } from "./lib/browser";
import { useHeroBanners } from "./lib/heroBanners";
import { isGenericPoster, movieImageSources } from "./lib/media";
import { useCollectionCovers, setCollectionCover } from "./lib/collectionCovers";

const CATEGORY_MATCH: Record<string, (m: Movie) => boolean> = {
  anime: (m) => m.genre.some((g) => g.toLowerCase() === "anime"),
  cartoon: (m) => m.genre.some((g) => g.toLowerCase() === "cartoon"),
  movies: (m) => !m.genre.some((g) => ["anime", "cartoon"].includes(g.toLowerCase())),
  tvshows: (m) => (m.rating || "").startsWith("TV"),
  new: (m) => m.year === new Date().getFullYear(),
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

function App() {
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [playingMovie, setPlayingMovie] = useState<Movie | null>(null);
  const [resumeAt, setResumeAt] = useState(0);
  const [myList, setMyList] = useState<Movie[]>([]);
  const [likedMovies, setLikedMovies] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
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

  // Load movies from Supabase on mount — hydrate from cache first for instant paint
  useEffect(() => {
    try {
      const cached = localStorage.getItem("vid:moviesCache:v2");
      if (cached) {
        const { uploaded, synced } = JSON.parse(cached);
        if (Array.isArray(uploaded) && Array.isArray(synced)) {
          setUploadedMovies(uploaded);
          setSyncedMovies(synced);
        }
      }
    } catch {}

    import("./lib/moviesRepo")
      .then(({ fetchAllMovies }) => fetchAllMovies())
      .then(({ uploaded, synced }) => {
        setUploadedMovies(uploaded);
        setSyncedMovies(synced);
        try {
          localStorage.setItem("vid:moviesCache:v2", JSON.stringify({ uploaded, synced }));
        } catch {}
      })
      .catch(() => {});

    return undefined;
  }, []);

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

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return displayItems.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.genre.some((g) => g.toLowerCase().includes(q)) ||
        m.description.toLowerCase().includes(q) ||
        (m.cast && m.cast.some((c) => c.toLowerCase().includes(q))) ||
        (m.creator && m.creator.toLowerCase().includes(q)),
    );
  }, [searchQuery, displayItems]);

  const getCategoryMovies = useCallback(() => {
    if (activeCategory === "mylist") return myList;
    const matcher = CATEGORY_MATCH[activeCategory];
    if (!matcher) return [];
    // Movies already placed in a custom row for THIS section must not also
    // appear in the auto grid below — otherwise the same title shows twice
    // (once in the custom row, once in the auto-generated grid).
    const scoped = new Set<number>();
    cfg.customRows?.forEach((row) => {
      if (!row.visible) return;
      const sec = row.section || "home";
      if (sec !== activeCategory && sec !== "all") return;
      resolveCustomRowItems(row).forEach((m) => {
        scoped.add(m.id);
        m.episodes?.forEach((e) => scoped.add(e.id));
      });
    });
    return displayItems.filter((m) => matcher(m) && !scoped.has(m.id));
  }, [activeCategory, myList, displayItems, cfg.customRows, resolveCustomRowItems]);

  const handlePlay = useCallback((movie: Movie, opts?: { fromStart?: boolean }) => {
    setSelectedMovie(null);
    // Auto-resume: any saved progress for this exact video is picked up, no
    // matter which row / modal / screen the Play press came from.
    setResumeAt(opts?.fromStart ? 0 : getSavedProgress(movie));
    setPlayingMovie(movie);
  }, []);

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
    try {
      localStorage.setItem(
        "vid:moviesCache:v2",
        JSON.stringify({ uploaded: nextUploaded, synced: nextSynced }),
      );
    } catch {}
  }, []);

  const showingSearch = searchQuery.trim().length > 0;
  const showingDiscover = activeCategory === "discover" && !showingSearch;
  const showingCategory =
    activeCategory !== "home" && activeCategory !== "discover" && !showingSearch;

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
        onCategoryChange={(cat: Category) => {
          setActiveCategory(cat);
          setSearchQuery("");
        }}
        onNotificationClick={() => setShowNotifications(!showNotifications)}
        showNotifications={showNotifications}
        onUploadClick={() => setShowUploadModal(true)}
        onSyncClick={() => setShowPlaylistSync(true)}
        onAiClick={() => setShowAiAssistant(true)}
        onCustomizeClick={() => setShowAdminEditor(true)}
        isAdmin={isAdmin}
        onLogout={handleLogout}
      />

      <main className="pt-16">
        {showNotifications && (
          <NotificationPanel
            onClose={closeNotifications}
            onMovieClick={(movie: Movie) => {
              setShowNotifications(false);
              setSelectedMovie(movie);
            }}
          />
        )}

        {showingSearch && (
          <SearchResults
            results={searchResults}
            query={searchQuery}
            onSelectMovie={setSelectedMovie}
            onPlay={(m) => handlePlay(m.episodes?.[0] || m)}
            isInMyList={isInMyList}
            isLiked={isLiked}
            toggleMyList={toggleMyList}
            toggleLike={toggleLike}
          />
        )}

        {showingDiscover && (
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
                    : activeCategory === "tvshows"
                      ? "TV Shows"
                      : activeCategory === "mylist"
                        ? "My List"
                        : activeCategory === "new"
                          ? "New & Popular"
                          : activeCategory}
            </h1>

            {/* Hindi dubbed anime shelf (official licensed YouTube channels). */}
            {activeCategory === "anime" && (
              <AnimeSection
                onSelectMovie={setSelectedMovie}
                onPlay={handlePlay}
                isInMyList={isInMyList}
                isLiked={isLiked}
                toggleMyList={toggleMyList}
                toggleLike={toggleLike}
                onEpisodesLoaded={handleAnimeEpisodesLoaded}
              />
            )}

            {/* Admin custom rows scoped to this section */}
            {cfg.customRows?.map((row) => {
              if (!row.visible) return null;
              const sec = row.section || "home";
              if (sec !== "all" && sec !== activeCategory) return null;
              const slots = resolveRowSlots(row);
              if (slots.length === 0) return null;
              return (
                <MovieRow
                  key={row.id}
                  title={row.title}
                  titleSize={row.titleSize}
                  slots={slots}
                  isLargeRow={row.isLarge}
                  onSelectMovie={setSelectedMovie}
                  onPlay={(m) => handlePlay(m.episodes?.[0] || m)}
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
              {getCategoryMovies().length === 0 ? (
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
                  {getCategoryMovies().map((movie) => (
                    <div
                      key={movie.id}
                      className="tv-category-card group cursor-pointer"
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
                          className={`absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center ${isTvBrowser() ? "hidden" : ""}`}
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
            </div>
          </div>
        )}

        {!showingSearch && !showingCategory && !showingDiscover && (
          <>
            <HeroBanner
              movies={heroMovies}
              onMoreInfo={(m) => setSelectedMovie(m)}
              onPlay={handlePlay}
              onUploadClick={() => setShowUploadModal(true)}
              onSyncClick={() => setShowPlaylistSync(true)}
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
                  const slots = resolveRowSlots(row);
                  if (slots.length === 0) return;
                  elements.push(
                    <MovieRow
                      key={row.id}
                      title={row.title}
                      titleSize={row.titleSize}
                      slots={slots}
                      isLargeRow={row.isLarge}
                      onSelectMovie={setSelectedMovie}
                      onPlay={(m) => handlePlay(m.episodes?.[0] || m)}
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

      <Suspense fallback={null}>
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
            episodes={(() => {
              const pid = playingMovie.playlistId;
              if (!pid) return undefined;
              const sortByEp = (a: Movie, b: Movie) =>
                (a.seasonNumber || 1) - (b.seasonNumber || 1) ||
                (a.episodeNumber || 0) - (b.episodeNumber || 0);
              const pick = (list: Movie[]) => {
                const siblings = list.filter((m) => m.playlistId === pid).sort(sortByEp);
                return siblings.length > 1 ? siblings : undefined;
              };
              return pick(syncedMovies) ?? pick(uploadedMovies) ?? pick(animeEpisodes);
            })()}
          />
        )}
      </Suspense>
    </div>
  );
}

export default App;
