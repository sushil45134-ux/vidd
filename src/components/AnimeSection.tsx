import { memo, useCallback, useEffect, useState } from "react";
import type { Movie } from "../data";
import { episodesToMovies, type AnimeEpisode } from "../lib/animeCatalog";
import MovieRow from "./MovieRow";

interface AnimeSectionProps {
  onSelectMovie: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  isInMyList: (movieId: number) => boolean;
  isLiked: (movieId: number) => boolean;
  toggleMyList: (movie: Movie) => void;
  toggleLike: (movieId: number) => void;
  /** Report the flat episode list upward so the player can build next/prev queues. */
  onEpisodesLoaded?: (episodes: Movie[]) => void;
}

/**
 * "Hindi Dubbed Anime" shelf. Fetches the /api/anime proxy (official Muse
 * India / Muse Hindi Dub YouTube feeds), groups episodes into series
 * collections, and renders them with the app's standard MovieRow cards. The
 * existing YouTube player plays every episode — no extra embed machinery.
 */
function AnimeSection({
  onSelectMovie,
  onPlay,
  isInMyList,
  isLiked,
  toggleMyList,
  toggleLike,
  onEpisodesLoaded,
}: AnimeSectionProps) {
  const [series, setSeries] = useState<Movie[]>([]);
  const [latestSeries, setLatestSeries] = useState<Movie[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const playFirst = useCallback((m: Movie) => onPlay(m.episodes?.[0] || m), [onPlay]);

  useEffect(() => {
    let active = true;

    const refresh = () => {
      fetch("/api/anime")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
        .then((data: { episodes?: AnimeEpisode[] }) => {
          if (!active) return;
          const list = Array.isArray(data.episodes) ? data.episodes : [];
          const { series, latestSeries, episodes } = episodesToMovies(list);
          setSeries(series);
          // A feed normally contains many old episodes. Freshness ordering makes
          // a newly discovered anime visible immediately even when it has only
          // one episode. Cap the daily shelf so it stays quick on TV browsers.
          setLatestSeries(latestSeries.slice(0, 10));
          onEpisodesLoaded?.(episodes);
          setState(series.length > 0 ? "ready" : "empty");
        })
        .catch(() => {
          if (!active) return;
          // Keep already loaded cards during a temporary refresh failure.
          setState((current) => (current === "ready" ? current : "empty"));
        });
    };

    refresh();
    // A TV/browser left open on the Anime page also receives newly published
    // shows without needing a reload. The API itself caches feeds for 10 min.
    const timer = window.setInterval(refresh, 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onEpisodesLoaded]);

  if (state === "loading") {
    return (
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
    );
  }

  if (state === "empty" || series.length === 0) return null;

  return (
    <div className="mt-2">
      {latestSeries.length > 0 && (
        <MovieRow
          title="🆕 Daily New Anime"
          movies={latestSeries}
          onSelectMovie={onSelectMovie}
          onPlay={playFirst}
          isInMyList={isInMyList}
          isLiked={isLiked}
          toggleMyList={toggleMyList}
          toggleLike={toggleLike}
        />
      )}
      <MovieRow
        title="Hindi Dubbed Anime Library"
        movies={series}
        onSelectMovie={onSelectMovie}
        onPlay={playFirst}
        isInMyList={isInMyList}
        isLiked={isLiked}
        toggleMyList={toggleMyList}
        toggleLike={toggleLike}
      />
    </div>
  );
}

export default memo(AnimeSection);
