import type { Movie } from "../data";
import { isTvBrowser } from "./browser";

export const FALLBACK_THUMBNAIL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23111111'/%3E%3Cstop offset='.58' stop-color='%231f1f1f'/%3E%3Cstop offset='1' stop-color='%23f47521' stop-opacity='.55'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='360' fill='url(%23g)'/%3E%3Ccircle cx='320' cy='180' r='52' fill='%23ffffff' fill-opacity='.12'/%3E%3Cpath d='M304 146v68l58-34z' fill='%23ffffff' fill-opacity='.78'/%3E%3C/svg%3E";

/**
 * TV card slots never render wider than ~360px, and a Chromium 69 compositor
 * pays for every decoded byte. `mqdefault.jpg` (320×180, true 16:9, no
 * letterbox bars) is the largest YouTube variant worth fetching there —
 * maxresdefault is roughly 8× the pixels. Hero banners and modals stay on the
 * high-resolution chain. Evaluated once: the UA never changes at runtime and
 * SSR (no navigator) always resolves to false, so desktop output is identical.
 */
const TV_CARDS = isTvBrowser();

function isUsableImage(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
}

/**
 * Ordered best-first, for heroes, modals and anything persisted. maxresdefault
 * is 1280×720 (true 16:9, no letterbox bars) — hqdefault is only 480×360
 * (4:3 with black bars for 16:9 videos), which looks low-res and mis-sized
 * when scaled up. SmartImage falls through to the next source when one 404s,
 * so it is safe to try maxres/sd first even when a video does not have them.
 *
 * Upload / playlist-sync flows store `youtubeThumbnailSources(id)[0]` into
 * the database, so this order must never be downgraded for the TV card path;
 * card rendering opts into {@link cardYouTubeThumbnailSources} instead.
 */
export function youtubeThumbnailSources(videoId?: string) {
  if (!videoId) return [];
  const base = `https://img.youtube.com/vi/${videoId}`;
  return [
    `${base}/maxresdefault.jpg`,
    `${base}/sddefault.jpg`,
    `${base}/hqdefault.jpg`,
    `${base}/mqdefault.jpg`,
  ];
}

/** Card-quality chain: 320×180 on TVs, full resolution everywhere else. */
export function cardYouTubeThumbnailSources(videoId?: string): string[] {
  if (!videoId) return [];
  if (!TV_CARDS) return youtubeThumbnailSources(videoId);
  const base = `https://img.youtube.com/vi/${videoId}`;
  // mqdefault exists for every video; hqdefault covers the rare case where a
  // specific upload serves a broken mq variant.
  return [`${base}/mqdefault.jpg`, `${base}/hqdefault.jpg`];
}

// Upgrade any hqdefault URL (e.g. one stored in the DB before this fix) to
// the higher-resolution variants, keeping the original as a fallback. On TV
// cards the same match downshifts to the 320×180 variant instead.
const HQ_THUMB_RE =
  /^(https?:\/\/(?:img\.youtube\.com|i\d?\.ytimg\.com)\/vi\/([A-Za-z0-9_-]{6,})\/)hqdefault\.jpg.*$/;

function resolveYouTubeThumb(url: string, tvCard: boolean): string[] {
  const match = url.match(HQ_THUMB_RE);
  if (!match) return [url];
  if (tvCard) return [`${match[1]}mqdefault.jpg`, url];
  return [`${match[1]}maxresdefault.jpg`, `${match[1]}sddefault.jpg`, url];
}

export function movieImageSources(movie: Movie, mode: "hero" | "card" = "card") {
  const tvCard = mode === "card" && TV_CARDS;
  const primary =
    mode === "hero"
      ? [movie.backdrop, movie.thumbnailUrl, movie.image]
      : [movie.thumbnailUrl, movie.image, movie.backdrop];

  return unique([
    ...primary.filter(isUsableImage).flatMap((url) => resolveYouTubeThumb(url, tvCard)),
    ...(tvCard
      ? cardYouTubeThumbnailSources(movie.youtubeId)
      : youtubeThumbnailSources(movie.youtubeId)),
    FALLBACK_THUMBNAIL,
  ]);
}
