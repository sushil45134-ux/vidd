/**
 * Hindi-dubbed anime catalog built from OFFICIAL, licensed YouTube channels.
 *
 * These channels (Muse India / Muse Hindi Dub) are the official licensors and
 * distributors — they publish full Hindi-dubbed anime episodes on YouTube for
 * free. We read their public RSS feeds, parse the episodes, and hand them to
 * the app's existing YouTube player. No piracy, no scrapers, no API key:
 * YouTube itself exposes a per-channel Atom feed at
 *   https://www.youtube.com/feeds/videos.xml?channel_id=<ID>
 *
 * The parsing helpers below are isomorphic (used by both the server route that
 * proxies the feeds and the client that renders them), so this module must
 * stay free of any browser/DOM-only code.
 */

import type { Movie, Season } from "../data";

/* ── Channel registry ─────────────────────────────────────────── */

export interface AnimeChannel {
  /** YouTube channel id (the `UC...` id, not the @handle). */
  id: string;
  /** Human label used in the UI / attribution. */
  name: string;
  /** Feed url used by the server proxy. */
  feedUrl: string;
}

export const ANIME_CHANNELS: AnimeChannel[] = [
  {
    id: "UCA9nLwuoOjfMJMNt6fG5Rlw",
    name: "Muse Hindi Dub",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCA9nLwuoOjfMJMNt6fG5Rlw",
  },
  {
    id: "UCYYhAzgWuxPauRXdPpLAX3Q",
    name: "Muse India",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCYYhAzgWuxPauRXdPpLAX3Q",
  },
];

/* ── Types ─────────────────────────────────────────────────────── */

export interface AnimeEpisode {
  /** YouTube video id (11 chars). */
  videoId: string;
  /** Raw entry title, e.g. "[Hindi Dub] HUNTER×HUNTER - Episode 012 | Muse IN". */
  title: string;
  /** Cleaned series name, e.g. "HUNTER×HUNTER". */
  seriesName: string;
  /** Absolute episode number parsed from "Episode N" (or 0 when unknown). */
  episodeNumber: number;
  /** Season number parsed from "Season N" / "(SNENN)" (defaults to 1). */
  seasonNumber: number;
  /** Thumbnail URL (hqdefault — always exists). */
  thumbnail: string;
  /** ISO 8601 published timestamp. */
  published: string;
  /** Source channel name. */
  channelName: string;
}

/* ── Small utilities ───────────────────────────────────────────── */

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/* ── Title parsing ─────────────────────────────────────────────── */

const LANG_MARKERS = [
  { re: /\[hindi\s*dub\]/i, lang: "hindi" },
  { re: /\[english\s*sub\]|\[en\s*sub\]/i, lang: "ensub" },
  { re: /\[telugu\s*dub\]/i, lang: "telugu" },
  { re: /\[tamil\s*dub\]/i, lang: "tamil" },
];

/** True when the title explicitly marks the episode as Hindi dubbed. */
export function isHindiDubTitle(title: string): boolean {
  return /hindi\s*dub/i.test(title);
}

/**
 * Turn a Muse-style title into a structured series/episode. Handles forms like:
 *   "[Hindi Dub] HUNTER×HUNTER - Episode 012 | Muse IN"
 *   "JoJo's Bizarre Adventure (S3): Diamond is Unbreakable - Episode 11 [Hindi Dub] | Muse IN"
 *   "[Hindi Dub] That Time I Got Reincarnated as a Slime - Episode 75 (S4E03) | Muse IN"
 *   "[Hindi Dub] Welcome To Demon School! Iruma-kun Season 3 - Episode 14 | Muse IN"
 */
export function parseAnimeTitle(title: string): {
  seriesName: string;
  episodeNumber: number;
  seasonNumber: number;
  cleanTitle: string;
} {
  let t = decodeEntities(title).trim();

  // Drop the "| Muse IN" / "| Muse India" tail.
  t = t.replace(/\s*\|\s*Muse[^|]*$/i, "").trim();

  // Language markers (removed so they don't pollute the series name).
  for (const { re } of LANG_MARKERS) {
    t = t.replace(re, "").trim();
  }

  // Season + episode encoded as (S4E03).
  let seasonNumber = 1;
  const se = t.match(/\(?S(\d{1,2})E(\d{1,3})\)?/i);
  if (se) seasonNumber = parseInt(se[1], 10);

  // "Season N" phrasing.
  const seasonWord = t.match(/\bseason\s*(\d{1,2})\b/i);
  if (seasonWord) seasonNumber = parseInt(seasonWord[1], 10);

  // Absolute episode number from "Episode N" / "EP N".
  let episodeNumber = 0;
  const ep = t.match(/(?:episode|ep)\s*[-:. ]?\s*(\d{1,4})/i);
  if (ep) episodeNumber = parseInt(ep[1], 10);

  // Series name = everything before the " - Episode N" segment (or before
  // "Season N - Episode N"), with trailing season markers removed.
  let seriesName = t
    .replace(/\s*[-–—]\s*(?:episode|ep)\s*[-:. ]?\s*\d{1,4}.*$/i, "")
    .replace(/\s*\(?S\d{1,2}E\d{1,3}\)?\s*$/i, "")
    .replace(/\s*season\s*\d{1,2}\s*$/i, "")
    .trim();

  // Fallback: no episode marker found — strip a trailing " - ..." separator.
  if (!ep) {
    seriesName = seriesName.replace(/\s*[-–—]\s*[^-–—]*$/i, "").trim();
  }

  if (!seriesName) seriesName = t;

  const cleanTitle = seriesName
    ? `${seriesName}${episodeNumber ? ` — E${episodeNumber}` : ""}`
    : t;

  return { seriesName, episodeNumber, seasonNumber, cleanTitle };
}

/* ── Feed parsing (Atom) ───────────────────────────────────────── */

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] : null;
}

/**
 * Parse one YouTube channel Atom feed into episode objects. Kept deliberately
 * regex-based (no DOM) so it runs in the server route on any runtime.
 */
export function parseYouTubeFeed(xml: string, channel: AnimeChannel): AnimeEpisode[] {
  const out: AnimeEpisode[] = [];
  if (!xml || typeof xml !== "string") return out;

  const blocks = xml.split(/<entry(?:\s[^>]*)?>/i).slice(1);
  for (const block of blocks) {
    const entry = block.split(/<\/entry>/i)[0];
    if (!entry) continue;

    const videoId =
      firstMatch(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/i) ||
      firstMatch(entry, /<id>\s*yt:video:([^<]+)<\/id>/i);
    if (!videoId) continue;

    const title = firstMatch(entry, /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
    if (!title) continue;

    const thumbnail =
      firstMatch(entry, /<media:thumbnail[^>]*url="([^"]+)"/i) ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const published = firstMatch(entry, /<published>([^<]+)<\/published>/i) ?? "";

    const parsed = parseAnimeTitle(title);
    out.push({
      videoId,
      title: decodeEntities(title).trim(),
      seriesName: parsed.seriesName,
      episodeNumber: parsed.episodeNumber,
      seasonNumber: parsed.seasonNumber,
      thumbnail,
      published,
      channelName: channel.name,
    });
  }

  return out;
}

/** Merge several feeds: drop duplicate video ids, newest first. */
export function dedupeEpisodes(episodes: AnimeEpisode[]): AnimeEpisode[] {
  const seen = new Set<string>();
  const unique: AnimeEpisode[] = [];
  for (const ep of episodes) {
    if (!ep.videoId || seen.has(ep.videoId)) continue;
    seen.add(ep.videoId);
    unique.push(ep);
  }
  unique.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  return unique;
}

/* ── Movie conversion ──────────────────────────────────────────── */

function episodeToMovie(ep: AnimeEpisode, playlistId: string, seriesName: string): Movie {
  return {
    id: hashString(ep.videoId) + 3_000_000_000,
    title: seriesName,
    description: `Hindi Dubbed • ${ep.title}`,
    image: ep.thumbnail,
    thumbnailUrl: ep.thumbnail,
    backdrop: ep.thumbnail,
    year: new Date().getFullYear(),
    rating: "TV-14",
    duration: "~24 min",
    genre: ["Anime"],
    match: 96,
    creator: ep.channelName,
    youtubeId: ep.videoId,
    playlistId,
    playlistTitle: seriesName,
    episodeNumber: ep.episodeNumber || undefined,
    seasonNumber: ep.seasonNumber || 1,
  };
}

/**
 * Group a flat episode list into series collections + flat episode rows,
 * mirroring the shape `buildCollections` produces so MovieModal / PlayerOverlay
 * work unchanged.
 */
export function episodesToMovies(episodes: AnimeEpisode[]): {
  series: Movie[];
  episodes: Movie[];
} {
  const bySeries = new Map<string, AnimeEpisode[]>();
  for (const ep of episodes) {
    const key = ep.seriesName.trim().toLowerCase();
    if (!key) continue;
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key)!.push(ep);
  }

  const series: Movie[] = [];
  const flatEpisodes: Movie[] = [];

  for (const [key, eps] of bySeries) {
    const sorted = [...eps].sort(
      (a, b) =>
        (a.seasonNumber || 1) - (b.seasonNumber || 1) ||
        (a.episodeNumber || 0) - (b.episodeNumber || 0) ||
        (a.published || "").localeCompare(b.published || ""),
    );

    const seriesName = sorted[0].seriesName;
    const playlistId = `anime:${key}`;
    const epMovies = sorted.map((ep) => episodeToMovie(ep, playlistId, seriesName));
    flatEpisodes.push(...epMovies);

    const seasonMap = new Map<number, Movie[]>();
    epMovies.forEach((m) => {
      const s = m.seasonNumber || 1;
      if (!seasonMap.has(s)) seasonMap.set(s, []);
      seasonMap.get(s)!.push(m);
    });
    const seasons: Season[] = [...seasonMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, seasonEps]) => ({
        seasonNumber,
        episodes: [...seasonEps].sort(
          (a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0),
        ),
      }));

    const cover = sorted[sorted.length - 1].thumbnail;
    const count = sorted.length;
    series.push({
      id: hashString(key) + 2_000_000_000,
      title: seriesName,
      description: `${count} Hindi dubbed episode${count !== 1 ? "s" : ""} • Official (Muse India)`,
      image: cover,
      thumbnailUrl: cover,
      backdrop: cover,
      year: new Date().getFullYear(),
      rating: "TV-14",
      duration: `${count} ep`,
      genre: ["Anime"],
      match: 96,
      creator: sorted[sorted.length - 1].channelName,
      playlistId,
      playlistTitle: seriesName,
      isCollection: true,
      episodes: epMovies,
      seasons,
    });
  }

  series.sort((a, b) => (b.episodes?.length || 0) - (a.episodes?.length || 0));
  flatEpisodes.sort(
    (a, b) =>
      (a.seasonNumber || 1) - (b.seasonNumber || 1) ||
      (a.episodeNumber || 0) - (b.episodeNumber || 0),
  );

  return { series, episodes: flatEpisodes };
}

/* ── Static seed ─────────────────────────────────────────────────
 * A small snapshot of real, official Hindi-dubbed episodes. Used only as a
 * fallback so the UI still renders when the live YouTube feed is unreachable
 * (e.g. sandboxed previews, transient network errors). Production prefers the
 * live feed.
 * ──────────────────────────────────────────────────────────────── */

export const ANIME_SEED: AnimeEpisode[] = [
  { videoId: "HJDOkJiLThA", title: "[Hindi Dub] HUNTER×HUNTER - Episode 012 | Muse IN", seriesName: "HUNTER×HUNTER", episodeNumber: 12, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/HJDOkJiLThA/hqdefault.jpg", published: "2026-09-12T15:00:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "8pVm6IaSvAY", title: "[Hindi Dub] HUNTER×HUNTER - Episode 011 | Muse IN", seriesName: "HUNTER×HUNTER", episodeNumber: 11, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/8pVm6IaSvAY/hqdefault.jpg", published: "2026-09-11T15:00:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "FFGodKdK-dw", title: "[Hindi Dub] HUNTER×HUNTER - Episode 010 | Muse IN", seriesName: "HUNTER×HUNTER", episodeNumber: 10, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/FFGodKdK-dw/hqdefault.jpg", published: "2026-09-10T15:00:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "ZjBm6v6hoDg", title: "[Hindi Dub] HUNTER×HUNTER - Episode 009 | Muse IN", seriesName: "HUNTER×HUNTER", episodeNumber: 9, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/ZjBm6v6hoDg/hqdefault.jpg", published: "2026-09-09T15:00:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "0N2YEU2ArM4", title: "[Hindi Dub] HUNTER×HUNTER - Episode 008 | Muse IN", seriesName: "HUNTER×HUNTER", episodeNumber: 8, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/0N2YEU2ArM4/hqdefault.jpg", published: "2026-09-08T15:00:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "_5ZffywaGbg", title: "[Hindi Dub] Ragna Crimson - Episode 08", seriesName: "Ragna Crimson", episodeNumber: 8, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/_5ZffywaGbg/hqdefault.jpg", published: "2026-09-12T14:30:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "vVVqOmYk_gY", title: "[Hindi Dub] Ragna Crimson - Episode 07", seriesName: "Ragna Crimson", episodeNumber: 7, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/vVVqOmYk_gY/hqdefault.jpg", published: "2026-09-11T14:30:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "wAM9TgnUu24", title: "[Hindi Dub] Ragna Crimson - Episode 06", seriesName: "Ragna Crimson", episodeNumber: 6, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/wAM9TgnUu24/hqdefault.jpg", published: "2026-09-10T14:30:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "hvInrlDdZ9M", title: "[Hindi Dub] Ragna Crimson - Episode 05", seriesName: "Ragna Crimson", episodeNumber: 5, seasonNumber: 1, thumbnail: "https://i.ytimg.com/vi/hvInrlDdZ9M/hqdefault.jpg", published: "2026-09-09T14:30:06+00:00", channelName: "Muse Hindi Dub" },
  { videoId: "vsjyfaY3C0o", title: "[Hindi Dub] That Time I Got Reincarnated as a Slime - Episode 75 (S4E03) | Muse IN", seriesName: "That Time I Got Reincarnated as a Slime", episodeNumber: 75, seasonNumber: 4, thumbnail: "https://i.ytimg.com/vi/vsjyfaY3C0o/hqdefault.jpg", published: "2026-09-12T16:30:06+00:00", channelName: "Muse India" },
  { videoId: "thVv2kT9vUs", title: "JoJo's Bizarre Adventure (S3): Diamond is Unbreakable - Episode 11 [Hindi Dub] | Muse IN", seriesName: "JoJo's Bizarre Adventure (S3): Diamond is Unbreakable", episodeNumber: 11, seasonNumber: 3, thumbnail: "https://i.ytimg.com/vi/thVv2kT9vUs/hqdefault.jpg", published: "2026-09-12T15:30:06+00:00", channelName: "Muse India" },
  { videoId: "qOI7d-vVJCo", title: "JoJo's Bizarre Adventure (S3): Diamond is Unbreakable - Episode 10 [Hindi Dub] | Muse IN", seriesName: "JoJo's Bizarre Adventure (S3): Diamond is Unbreakable", episodeNumber: 10, seasonNumber: 3, thumbnail: "https://i.ytimg.com/vi/qOI7d-vVJCo/hqdefault.jpg", published: "2026-09-11T15:30:06+00:00", channelName: "Muse India" },
  { videoId: "rhRNMemVlxI", title: "[Hindi Dub] Welcome To Demon School! Iruma-kun Season 3 - Episode 14 | Muse IN", seriesName: "Welcome To Demon School! Iruma-kun", episodeNumber: 14, seasonNumber: 3, thumbnail: "https://i.ytimg.com/vi/rhRNMemVlxI/hqdefault.jpg", published: "2026-09-12T15:00:06+00:00", channelName: "Muse India" },
  { videoId: "-oTJvROwsZY", title: "[Hindi Dub] Welcome To Demon School! Iruma-kun Season 3 - Episode 13 | Muse IN", seriesName: "Welcome To Demon School! Iruma-kun", episodeNumber: 13, seasonNumber: 3, thumbnail: "https://i.ytimg.com/vi/-oTJvROwsZY/hqdefault.jpg", published: "2026-09-11T15:00:06+00:00", channelName: "Muse India" },
];
