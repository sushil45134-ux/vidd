import type { Movie } from "../data";
import { movieImageSources } from "./media";

/**
 * Shared helpers for the Crunchyroll-style player chrome (top bar, scrubber
 * and the Episodes drawer) used by `EmbedPlayer` — the surface that plays
 * Nxsha / NHD / Vimeo / Dailymotion / uploaded files.
 *
 * Everything here is pure + SSR-safe so the chrome renders identically on the
 * server pass and after hydration.
 */

/** Crunchyroll brand orange. Kept in one place for inline styles (SVG fills,
 * gradients) that cannot use the `cr-orange` Tailwind utility. */
export const CR_ORANGE = "#f47521";
export const CR_ORANGE_SOFT = "rgba(244, 117, 33, 0.35)";

/** `95` → `1:35`, `3725` → `1:02:05`. Non-finite/blank input → `0:00`. */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
  const total = Math.floor(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `-95` → `-1:35` (Crunchyroll shows the remaining time, not the total). */
export function formatRemaining(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
  return `-${formatClock(totalSeconds)}`;
}

/** One row inside the Episodes drawer. */
export interface ChromeEpisode {
  id: number;
  /** Episode number when the library knows it (anime/series rows do). */
  episodeNumber?: number | null;
  seasonNumber?: number | null;
  title: string;
  /** Short synopsis — clamped to two lines in the drawer. */
  description?: string;
  /** Poster/backdrop sources, best first (see `movieImageSources`). */
  thumbnail?: string[];
  duration?: string;
}

export interface SeasonGroup {
  seasonNumber: number;
  label: string;
  episodes: ChromeEpisode[];
}

function seasonOf(ep: ChromeEpisode, fallback: number): number {
  const n = ep.seasonNumber;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Group a queue into seasons the way Crunchyroll's episode list does.
 * Rows without a season number land in `fallbackSeason` (1), and the result is
 * always sorted by season then episode so the drawer never shows a shuffled
 * list even if the caller passed one.
 */
export function groupEpisodesBySeason(
  episodes: ChromeEpisode[],
  fallbackSeason = 1,
): SeasonGroup[] {
  const bySeason = new Map<number, ChromeEpisode[]>();

  for (const ep of episodes) {
    const season = seasonOf(ep, fallbackSeason);
    const bucket = bySeason.get(season);
    if (bucket) bucket.push(ep);
    else bySeason.set(season, [ep]);
  }

  const sortEpisodes = (list: ChromeEpisode[]) =>
    [...list].sort((a, b) => (a.episodeNumber ?? Number.MAX_SAFE_INTEGER) - (b.episodeNumber ?? 0));

  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, list]) => ({
      seasonNumber,
      label: `Season ${seasonNumber}`,
      episodes: sortEpisodes(list),
    }));
}

/** Convert a same-playlistId queue into drawer rows (artwork resolved here so
 * the drawer never has to touch `Movie` shapes again). */
export function toChromeEpisodes(queue: Movie[]): ChromeEpisode[] {
  return queue.map((m) => ({
    id: m.id,
    episodeNumber: m.episodeNumber ?? null,
    seasonNumber: m.seasonNumber ?? null,
    title: m.title,
    description: m.description,
    duration: m.duration,
    thumbnail: movieImageSources(m, "card"),
  }));
}

/**
 * `S1:E39 · Naruto Shippūden` style label for the chrome top bar. Returns null
 * when the row carries no episode numbering (plain movies/uploads), where
 * Crunchyroll only shows the title.
 */
export function episodeTagLabel(ep: {
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): string | null {
  const season = ep.seasonNumber;
  const episode = ep.episodeNumber;
  if (typeof episode !== "number" || !Number.isFinite(episode) || episode <= 0) return null;
  if (typeof season === "number" && Number.isFinite(season) && season > 0) {
    return `S${Math.floor(season)}:E${Math.floor(episode)}`;
  }
  return `E${Math.floor(episode)}`;
}

/** Human title for an episode row: `E39 · <title>` when numbered. */
export function episodeRowTitle(ep: ChromeEpisode): string {
  const tag = episodeTagLabel(ep);
  if (!tag) return ep.title;
  // Some imported rows already repeat the numbering in the title.
  const clean = ep.title.replace(
    /^\s*(?:s\d{1,2}\s*[:·-]\s*)?e(?:p(?:isode)?)?\s*\d{1,4}\s*[:·-]\s*/i,
    "",
  );
  return `${tag} · ${clean || ep.title}`;
}
