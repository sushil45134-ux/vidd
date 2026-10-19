import { useCallback, useMemo, useState, useEffect } from "react";
import type { Movie } from "../data";
import { VideoPlayer } from "./VideoPlayer";
import { EmbedPlayer } from "./EmbedPlayer";
import { isRemoteMediaUrl } from "../lib/videoSource";
import { buildMovieboxPageUrl, buildMovieboxResolverUrl, isMovieboxUrl } from "../lib/moviebox";
import MovieboxPagePlayer from "./MovieboxPagePlayer";

export default function PlayerOverlay({
  movie,
  onClose,
  episodes,
  startAt = 0,
  onProgress,
  onEnded,
  onUnavailable,
}: {
  movie: Movie;
  onClose(): void;
  episodes?: Movie[];
  /** Resume offset (seconds) — applies only to the initially opened video. */
  startAt?: number;
  /** Playback clock, attributed to the episode actually on screen. */
  onProgress?: (movie: Movie, currentSec: number, durationSec: number) => void;
  /** The episode on screen ended. */
  onEnded?: (movie: Movie) => void;
  onUnavailable?: (movie: Movie) => void;
}) {
  const queue = useMemo(() => {
    if (!episodes || episodes.length < 2) return [];
    const playable = episodes.filter((e) => !!e.youtubeId || !!e.embedUrl || !!e.videoUrl);
    const selectedIsPlayable = !!movie.youtubeId || !!movie.embedUrl || !!movie.videoUrl;

    // Never let a stale/partial sibling list replace the episode the user
    // actually selected. Previously, when that episode was missing, initialIdx
    // silently became 0 and the first (wrong) episode started playing.
    if (selectedIsPlayable && !playable.some((episode) => episode.id === movie.id)) {
      return [...playable, movie].sort(
        (a, b) =>
          (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1) ||
          (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
      );
    }
    return playable;
  }, [episodes, movie]);

  const initialIdx = useMemo(() => {
    const i = queue.findIndex((e) => e.id === movie.id);
    return i >= 0 ? i : -1;
  }, [queue, movie.id]);

  const [idx, setIdx] = useState(initialIdx);

  useEffect(() => {
    setIdx(initialIdx);
  }, [initialIdx, movie.id]);

  // MovieBox full-page mode (default) vs direct-video mode (fallback). Har
  // naye title par wapas full-page se shuru — user ko M2Box ka poora page
  // (episode grid ke saath) chahiye, direct sirf tab jab frame na chale.
  const [movieboxDirect, setMovieboxDirect] = useState(false);

  useEffect(() => {
    setMovieboxDirect(false);
  }, [movie.id]);

  const current = queue[idx] || movie;

  // Queue siblings start from 0 — only the video the user pressed Play on
  // carries the saved resume offset.
  const effectiveStartAt = current.id === movie.id ? startAt : 0;
  const handleProgress = useCallback(
    (sec: number, dur: number) => onProgress?.(current, sec, dur),
    [onProgress, current],
  );
  const handleEnded = useCallback(() => onEnded?.(current), [onEnded, current]);

  // Series queue (same playlistId) works for embeds/videos just like YouTube —
  // Prev / Next swap `idx` and PlayerOverlay re-renders the player with the
  // sibling episode's src. No auto-next: iframe providers (Nxsha & co.) have
  // no reliable end-of-video event.
  const hasPrev = queue.length > 1 && idx > 0;
  const hasNext = queue.length > 1 && idx < queue.length - 1;

  // Rows saved by earlier builds parked a raw media address in `embedUrl`
  // (a pasted .m3u8/.mp4 used to be treated as a generic iframe). Framing a
  // playlist can never play, so such rows are routed to the video player, which
  // proxies and plays them properly.
  const embedIsDirectMedia = !!current.embedUrl && isRemoteMediaUrl(current.embedUrl);

  // MovieBox/m2box watch links parked in embedUrl/videoUrl: by default the
  // FULL M2Box watch page opens inside our site (their player + episode
  // grid + search, exactly like m2box.org) — see MovieboxPagePlayer. Our
  // /api/moviebox direct-video resolver stays as the one-tap fallback for
  // when the frame ever comes up blank. The row's own season/episode
  // numbers win, so one base m2box link can be pasted on every episode row
  // of a series. See docs/MOVIEBOX_EMBED.md.
  const movieboxCandidate =
    (current.embedUrl && isMovieboxUrl(current.embedUrl) && current.embedUrl) ||
    (current.videoUrl && isMovieboxUrl(current.videoUrl) && current.videoUrl) ||
    undefined;
  const movieboxSeEp = {
    se: current.seasonNumber != null && current.seasonNumber > 0 ? current.seasonNumber : undefined,
    ep:
      current.episodeNumber != null && current.episodeNumber > 0
        ? current.episodeNumber
        : undefined,
  };
  const movieboxSrc = movieboxCandidate
    ? buildMovieboxResolverUrl(movieboxCandidate, movieboxSeEp)
    : null;
  const movieboxPageUrl = movieboxCandidate
    ? buildMovieboxPageUrl(movieboxCandidate, movieboxSeEp)
    : null;

  if (!current.youtubeId && movieboxPageUrl && !movieboxDirect) {
    return (
      <MovieboxPagePlayer
        key={`mb-page-${current.id}`}
        pageUrl={movieboxPageUrl}
        title={current.title}
        onClose={onClose}
        onTryDirect={movieboxSrc ? () => setMovieboxDirect(true) : undefined}
      />
    );
  }

  // Non-YouTube embeds (Vimeo, Dailymotion, Odysee, BitChute, Rumble,
  // Bilibili, Twitch, Streamable, Facebook, Google Drive, MEGA, generic iframe).
  if (!current.youtubeId && current.embedUrl && !embedIsDirectMedia && !movieboxSrc) {
    return (
      <EmbedPlayer
        key={current.id}
        src={current.embedUrl}
        kind="iframe"
        onClose={onClose}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={hasPrev ? () => setIdx(idx - 1) : undefined}
        onNext={hasNext ? () => setIdx(idx + 1) : undefined}
        startAt={effectiveStartAt}
        onProgress={handleProgress}
        onUnavailable={() => onUnavailable?.(current)}
        onEnded={handleEnded}
      />
    );
  }

  // Uploaded file / direct video URL (or a media address parked in embedUrl).
  const mediaSrc = !current.youtubeId
    ? movieboxSrc || (embedIsDirectMedia ? current.embedUrl : undefined) || current.videoUrl
    : undefined;
  if (mediaSrc) {
    return (
      <EmbedPlayer
        key={current.id}
        src={mediaSrc}
        kind="video"
        audioSources={current.audioSources}
        onClose={onClose}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={hasPrev ? () => setIdx(idx - 1) : undefined}
        onNext={hasNext ? () => setIdx(idx + 1) : undefined}
        startAt={effectiveStartAt}
        onProgress={handleProgress}
        onUnavailable={() => onUnavailable?.(current)}
        onEnded={handleEnded}
      />
    );
  }

  const youtubeId = current.youtubeId || movie.youtubeId || "dQw4w9WgXcQ";

  const queueItems = queue.map((e) => ({
    youtubeId: e.youtubeId || "",
    title:
      e.episodeNumber != null
        ? `E${e.episodeNumber}${e.seasonNumber ? ` • S${e.seasonNumber}` : ""}: ${e.title}`
        : e.title,
    thumbnail: e.image,
  }));

  return (
    <VideoPlayer
      key={current.id}
      videoId={youtubeId}
      onClose={onClose}
      queueItems={queue.length > 1 ? queueItems : undefined}
      currentQueueIndex={queue.length > 1 ? idx : undefined}
      onJumpTo={(i) => setIdx(i)}
      onNext={hasNext ? () => setIdx(idx + 1) : undefined}
      onPrev={hasPrev ? () => setIdx(idx - 1) : undefined}
      hasNext={hasNext}
      hasPrev={hasPrev}
      startAt={effectiveStartAt}
      onProgress={handleProgress}
      onEnded={handleEnded}
    />
  );
}
