import { useState, useCallback, useEffect, useMemo } from "react";
import Navbar from "./components/Navbar";
import HeroBanner from "./components/HeroBanner";
import MovieRow from "./components/MovieRow";
import MovieModal from "./components/MovieModal";

import PlayerOverlay from "./components/PlayerOverlay";
import SearchResults from "./components/SearchResults";
import NotificationPanel from "./components/NotificationPanel";
import UploadModal from "./components/UploadModal";
import PlaylistSync from "./components/PlaylistSync";
import AiAssistant from "./components/AiAssistant";
import AdminRowsEditor from "./components/AdminRowsEditor";
import UnifiedSearch from "./components/UnifiedSearch";
import ThumbnailEditor from "./components/ThumbnailEditor";


import type { Movie, Category } from "./data";
import { getMovieRef, useSiteConfig, type CustomRow, type RowKey } from "./lib/customization";
import { useHeroBanners } from "./lib/heroBanners";
import {
  fetchAllMovies,
  insertMovies,
  deleteMovieById,
  deleteMoviesByPlaylist,
  updateMovieThumbnail,
} from "./lib/moviesRepo";


const CATEGORY_MATCH: Record<string, (m: Movie) => boolean> = {
  anime: (m) => m.genre.some((g) => g.toLowerCase() === "anime"),
  cartoon: (m) => m.genre.some((g) => g.toLowerCase() === "cartoon"),
  movies: (m) =>
    !m.genre.some((g) => ["anime", "cartoon"].includes(g.toLowerCase())),
  tvshows: (m) => (m.rating || "").startsWith("TV"),
  new: (m) => m.year === new Date().getFullYear(),
};

function App() {
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [playingMovie, setPlayingMovie] = useState<Movie | null>(null);
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
  const [isAdmin, setIsAdmin] = useState(false);
  const cfg = useSiteConfig();
  const heroBannerOverrides = useHeroBanners();

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

  // Load movies from Supabase on mount
  useEffect(() => {
    fetchAllMovies().then(({ uploaded, synced }) => {
      setUploadedMovies(uploaded);
      setSyncedMovies(synced);
    });
  }, []);

  const allMovies = useMemo(
    () => [...uploadedMovies, ...syncedMovies],
    [uploadedMovies, syncedMovies]
  );

  // Group synced episodes into playlist collections (Crunchyroll-style)
  const syncedCollections = useMemo<Movie[]>(() => {
    const map = new Map<string, Movie[]>();
    syncedMovies.forEach((m) => {
      const key = m.playlistId || `single_${m.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    const out: Movie[] = [];
    map.forEach((eps, key) => {
      // Group by seasonNumber (default 1)
      const seasonMap = new Map<number, Movie[]>();
      eps.forEach((e) => {
        const s = e.seasonNumber || 1;
        if (!seasonMap.has(s)) seasonMap.set(s, []);
        seasonMap.get(s)!.push(e);
      });
      const seasons = Array.from(seasonMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([seasonNumber, seasonEps]) => ({
          seasonNumber,
          episodes: [...seasonEps].sort(
            (a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0)
          ),
        }));
      const flatEps = seasons.flatMap((s) => s.episodes);
      const first = flatEps[0];
      let hash = 0;
      for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
      out.push({
        ...first,
        id: Math.abs(hash) + 1_000_000_000,
        title: first.playlistTitle || first.title,
        description:
          `${seasons.length > 1 ? `${seasons.length} seasons • ` : ""}${flatEps.length} episode${flatEps.length !== 1 ? "s" : ""}`,
        isCollection: true,
        episodes: flatEps,
        seasons,
      });
    });
    return out;
  }, [syncedMovies]);

  // What we show in rows / categories (collections instead of individual synced episodes)
  const displayItems = useMemo(
    () => [...uploadedMovies, ...syncedCollections],
    [uploadedMovies, syncedCollections]
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
    [displayItems]
  );

  const existingYtIds = useMemo(() => {
    const ids = new Set<string>();
    allMovies.forEach((m) => {
      if (m.youtubeId) ids.add(m.youtubeId);
    });
    return ids;
  }, [allMovies]);

  const handlePlaylistSync = useCallback(async (movies: Movie[]) => {
    setShowPlaylistSync(false);
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
    [myList]
  );
  const isLiked = useCallback(
    (movieId: number) => likedMovies.has(movieId),
    [likedMovies]
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allMovies.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.genre.some((g) => g.toLowerCase().includes(q)) ||
        m.description.toLowerCase().includes(q) ||
        (m.cast && m.cast.some((c) => c.toLowerCase().includes(q))) ||
        (m.creator && m.creator.toLowerCase().includes(q))
    );
  }, [searchQuery, allMovies]);

  const getCategoryMovies = useCallback(() => {
    if (activeCategory === "mylist") return myList;
    const matcher = CATEGORY_MATCH[activeCategory];
    return matcher ? displayItems.filter(matcher) : [];
  }, [activeCategory, myList, displayItems]);


  const handlePlay = useCallback((movie: Movie) => {
    setSelectedMovie(null);
    setPlayingMovie(movie);
  }, []);

  const handleUpload = useCallback(async (movies: Movie | Movie[]) => {
    const arr = Array.isArray(movies) ? movies : [movies];
    setShowUploadModal(false);
    const saved = await insertMovies(arr, "uploaded");
    const toAdd = saved.length > 0 ? saved : arr;
    setUploadedMovies((prev) => [...toAdd, ...prev]);
    setMyList((prev) => [...toAdd, ...prev]);
    setTimeout(() => setPlayingMovie(toAdd[0]), 500);
  }, []);

  // Admin-only: delete an uploaded video, a single synced video, or a whole
  // synced playlist (collection). Removes it from every list it lives in.
  const handleDelete = useCallback(async (movie: Movie) => {
    // Whole playlist collection: drop every synced episode sharing the playlistId.
    if (movie.isCollection && movie.episodes && movie.episodes.length > 0) {
      const pid = movie.episodes[0].playlistId;
      const epIds = new Set(movie.episodes.map((e) => e.id));
      if (pid) {
        await deleteMoviesByPlaylist(pid);
      } else {
        await Promise.all(
          movie.episodes.map((e) => deleteMovieById(e.id))
        );
      }
      setSyncedMovies((prev) =>
        prev.filter((m) => (pid ? m.playlistId !== pid : !epIds.has(m.id)))
      );
      setMyList((prev) =>
        prev.filter((m) => m.id !== movie.id && !epIds.has(m.id))
      );
      setLikedMovies((prev) => {
        const next = new Set(prev);
        next.delete(movie.id);
        epIds.forEach((id) => next.delete(id));
        return next;
      });
      return;
    }
    // Single item (uploaded or standalone synced).
    await deleteMovieById(movie.id);
    setUploadedMovies((prev) => prev.filter((m) => m.id !== movie.id));
    setSyncedMovies((prev) => prev.filter((m) => m.id !== movie.id));
    setMyList((prev) => prev.filter((m) => m.id !== movie.id));
    setLikedMovies((prev) => {
      const next = new Set(prev);
      next.delete(movie.id);
      return next;
    });
  }, []);

  // Admin-only: replace an existing item's displayed thumbnail image.
  const handleUpdateThumbnail = useCallback(
    async (movieId: number, newUrl: string) => {
      const patch = (m: Movie): Movie =>
        m.id === movieId ? { ...m, image: newUrl, thumbnailUrl: newUrl, backdrop: newUrl } : m;
      setUploadedMovies((prev) => prev.map(patch));
      setSyncedMovies((prev) => prev.map(patch));
      setMyList((prev) => prev.map(patch));
      setSelectedMovie((prev) => (prev ? patch(prev) : prev));
      setThumbnailEditMovie((prev) => (prev ? patch(prev) : prev));
      await updateMovieThumbnail(movieId, newUrl);
    },
    []
  );


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
    <div className="tv-app-shell bg-black min-h-screen text-white">
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

      <main className="tv-main pt-16">

      {showNotifications && (
        <NotificationPanel
          onClose={() => setShowNotifications(false)}
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
          onPlay={handlePlay}
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
            const saved = await insertMovies([movie], "uploaded");
            const toAdd = saved[0] ?? movie;
            setUploadedMovies((prev) => [toAdd, ...prev]);
            setMyList((prev) => [toAdd, ...prev]);
          }}
        />
      )}

      {showingCategory && (
        <div className="tv-section pt-6 min-h-screen">
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

          {/* Admin custom rows scoped to this section */}
          {cfg.customRows?.map((row) => {
            if (!row.visible) return null;
            const sec = row.section || "home";
            if (sec !== "all" && sec !== activeCategory) return null;
            const items = resolveCustomRowItems(row);
            if (items.length === 0) return null;
            return (
              <MovieRow
                key={row.id}
                title={row.title}
                titleSize={row.titleSize}
                movies={items}
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

          <div className="tv-section px-4 md:px-12">
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
            <div className="tv-card-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {getCategoryMovies().map((movie) => (
                <div
                  key={movie.id}
                  className="tv-grid-item group cursor-pointer"
                  onClick={() => setSelectedMovie(movie)}
                >
                  <div className="tv-card-media relative overflow-hidden rounded-md aspect-video bg-gray-800">
                    <img
                      src={movie.image}
                      alt={movie.title}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center">
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
                  <p className="text-gray-300 text-sm mt-2 truncate">
                    {movie.title}
                  </p>
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
            {/* Synced playlists no longer auto-appear on home.
                Admin adds them via Custom Rows when desired. */}



            {cfg.customRows?.map((row) => {
              if (!row.visible) return null;
              const sec = row.section || "home";
              if (sec !== "home" && sec !== "all") return null;
              const items = resolveCustomRowItems(row);
              if (items.length === 0) return null;
              return (
                <MovieRow
                  key={row.id}
                  title={row.title}
                  titleSize={row.titleSize}
                  movies={items}
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

          </div>

        </>
      )}

      </main>

      {selectedMovie && (
        <MovieModal
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
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
        <AiAssistant
          onClose={() => setShowAiAssistant(false)}
          onAdd={handleUpload}
        />
      )}

      {showAdminEditor && (
        <AdminRowsEditor
          onClose={() => setShowAdminEditor(false)}
          availableMovies={displayItems}
        />
      )}

      {thumbnailEditMovie && (
        <ThumbnailEditor
          movie={thumbnailEditMovie}
          onClose={() => setThumbnailEditMovie(null)}
          onSave={(url) => handleUpdateThumbnail(thumbnailEditMovie.id, url)}
        />
      )}




      {playingMovie && (
        <PlayerOverlay
          movie={playingMovie}
          onClose={() => setPlayingMovie(null)}
          episodes={(() => {
            const pid = playingMovie.playlistId;
            if (!pid) return undefined;
            const siblings = syncedMovies
              .filter((m) => m.playlistId === pid)
              .sort(
                (a, b) =>
                  (a.seasonNumber || 1) - (b.seasonNumber || 1) ||
                  (a.episodeNumber || 0) - (b.episodeNumber || 0)
              );
            return siblings.length > 1 ? siblings : undefined;
          })()}
        />
      )}

      
    </div>
  );
}

export default App;
