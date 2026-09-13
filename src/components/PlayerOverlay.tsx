import { useMemo, useState, useEffect } from "react";
import type { Movie } from "../data";
import { VideoPlayer } from "./VideoPlayer";
import { EmbedPlayer } from "./EmbedPlayer";

export default function PlayerOverlay({
  movie,
  onClose,
  episodes,
}: {
  movie: Movie;
  onClose(): void;
  episodes?: Movie[];
}) {
  const queue = useMemo(() => {
    if (!episodes || episodes.length < 2) return [];
    return episodes.filter((e) => !!e.youtubeId || !!e.embedUrl || !!e.videoUrl);
  }, [episodes]);

  const initialIdx = useMemo(() => {
    const i = queue.findIndex((e) => e.id === movie.id);
    return i >= 0 ? i : 0;
  }, [queue, movie.id]);

  const [idx, setIdx] = useState(initialIdx);

  useEffect(() => {
    setIdx(initialIdx);
  }, [initialIdx, movie.id]);

  const current = queue[idx] || movie;

  // Series queue (same playlistId) works for embeds/videos just like YouTube —
  // Prev / Next swap `idx` and PlayerOverlay re-renders the player with the
  // sibling episode's src. No auto-next: iframe providers (Nxsha & co.) have
  // no reliable end-of-video event.
  const hasPrev = queue.length > 1 && idx > 0;
  const hasNext = queue.length > 1 && idx < queue.length - 1;

  // Non-YouTube embeds (Vimeo, Dailymotion, Odysee, BitChute, Rumble,
  // Bilibili, Twitch, Streamable, Facebook, Google Drive, MEGA, generic iframe).
  if (!current.youtubeId && current.embedUrl) {
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
      />
    );
  }

  // Uploaded file / direct video URL.
  if (!current.youtubeId && !current.embedUrl && current.videoUrl) {
    return (
      <EmbedPlayer
        key={current.id}
        src={current.videoUrl}
        kind="video"
        onClose={onClose}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={hasPrev ? () => setIdx(idx - 1) : undefined}
        onNext={hasNext ? () => setIdx(idx + 1) : undefined}
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
    />
  );
}
