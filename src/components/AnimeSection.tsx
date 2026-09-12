import { useEffect, useState } from "react";
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
export default function AnimeSection({
  onSelectMovie,
  onPlay,
  isInMyList,
  isLiked,
  toggleMyList,
  toggleLike,
  onEpisodesLoaded,
}: AnimeSectionProps) {
  const [series, setSeries] = useState<Movie[]>([]);
  const [episodes, setEpisodes] = useState<Movie[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    let active = true;

    fetch("/api/anime")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((data: { episodes?: AnimeEpisode[] }) => {
        if (!active) return;
        const list = Array.isArray(data.episodes) ? data.episodes : [];
        const { series, episodes } = episodesToMovies(list);
        setSeries(series);
        setEpisodes(episodes);
        onEpisodesLoaded?.(episodes);
        setState(series.length > 0 ? "ready" : "empty");
      })
      .catch(() => {
        if (!active) return;
        setState("empty");
      });

    return () => {
      active = false;
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
      <MovieRow
        title="Hindi Dubbed Anime"
        movies={series}
        onSelectMovie={onSelectMovie}
        onPlay={(m) => onPlay(m.episodes?.[0] || m)}
        isInMyList={isInMyList}
        isLiked={isLiked}
        toggleMyList={toggleMyList}
        toggleLike={toggleLike}
      />

      {episodes.length > 0 && (
        <MovieRow
          title="New Hindi Dubbed Episodes"
          movies={episodes.slice(0, 20)}
          onSelectMovie={onSelectMovie}
          onPlay={onPlay}
          isInMyList={isInMyList}
          isLiked={isLiked}
          toggleMyList={toggleMyList}
          toggleLike={toggleLike}
        />
      )}
    </div>
  );
}
