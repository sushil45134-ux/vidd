import type { Movie } from "../data";

export const FALLBACK_THUMBNAIL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23111111'/%3E%3Cstop offset='.58' stop-color='%231f1f1f'/%3E%3Cstop offset='1' stop-color='%23f47521' stop-opacity='.55'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='360' fill='url(%23g)'/%3E%3Ccircle cx='320' cy='180' r='52' fill='%23ffffff' fill-opacity='.12'/%3E%3Cpath d='M304 146v68l58-34z' fill='%23ffffff' fill-opacity='.78'/%3E%3C/svg%3E";

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

export function youtubeThumbnailSources(videoId?: string) {
  if (!videoId) return [];
  // Ordered best-first. maxresdefault is 1280×720 (true 16:9, no letterbox
  // bars) — hqdefault is only 480×360 (4:3 with black bars for 16:9 videos),
  // which looks low-res and mis-sized when scaled up (hero banner, modals).
  // SmartImage falls through to the next source when one 404s, so it is safe
  // to try maxres/sd first even when a video does not have them.
  return [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
  ];
}

// Upgrade any hqdefault URL (e.g. one stored in the DB before this fix) to
// the higher-resolution variants, keeping the original as a fallback.
const HQ_THUMB_RE =
  /^(https?:\/\/(?:img\.youtube\.com|i\d?\.ytimg\.com)\/vi\/([A-Za-z0-9_-]{6,})\/)hqdefault\.jpg.*$/;

function upgradeYouTubeThumb(url: string): string[] {
  const match = url.match(HQ_THUMB_RE);
  if (!match) return [url];
  return [`${match[1]}maxresdefault.jpg`, `${match[1]}sddefault.jpg`, url];
}

export function movieImageSources(movie: Movie, mode: "hero" | "card" = "card") {
  const primary =
    mode === "hero"
      ? [movie.backdrop, movie.thumbnailUrl, movie.image]
      : [movie.thumbnailUrl, movie.image, movie.backdrop];

  return unique([
    ...primary.filter(isUsableImage).flatMap(upgradeYouTubeThumb),
    ...youtubeThumbnailSources(movie.youtubeId),
    FALLBACK_THUMBNAIL,
  ]);
}
