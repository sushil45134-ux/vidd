/**
 * Nxsha Direct Fetch — client helpers
 * ====================================
 * /api/nxsha-fetch se aaya TMDB-accurate season/episode data ko Movie[] me
 * convert karta hai, har episode ke liye Nxsha embed URL ke saath.
 *
 * AniList/Jikan wale purane flow se behtar kyun:
 *   - Episode list wahi hai jo Nxsha ke player me dikhti hai (TMDB mirror)
 *   - Sirf aired episodes aate hain — "12 me se 1" wali partial-list bug nahi
 *   - Season numbering TMDB/Nxsha ke saath 1:1 — koi renumbering hack nahi
 *   - Anime ke saath-saath HAR TV series ke liye kaam karta hai
 */

import type { Movie } from "../data";
import { getProvider } from "./imdbSeries";

export interface NxshaEpisodeOut {
  episodeNumber: number;
  title: string;
  aired: string;
  image: string;
  runtime: string;
}

export interface NxshaSeasonOut {
  seasonNumber: number;
  title: string;
  episodesCount: number;
  airedCount: number;
  episodes: NxshaEpisodeOut[];
}

export interface NxshaFetchOut {
  tmdbId: string;
  title: string;
  year?: number;
  overview: string;
  poster: string;
  backdrop: string;
  genres: string[];
  totalSeasons: number;
  totalAired: number;
  totalEpisodes: number;
  seasons: NxshaSeasonOut[];
  sampleEmbed: string;
  source: "nxsha-tmdb";
}

/** Naye TMDB-accurate collections ka playlist prefix — App.tsx/MovieModal ke
 *  legacy Nxsha season-renumbering hacks isse dekh kar skip karte hain. */
export const NXSHA_TV_PREFIX = "nxsha-tv-";

export async function fetchNxshaDirect(
  q: string,
  includeSpecials: boolean,
): Promise<NxshaFetchOut> {
  const params = new URLSearchParams({ q: q.trim() });
  if (includeSpecials) params.set("specials", "1");
  const res = await fetch(`/api/nxsha-fetch?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Nxsha fetch failed");
  return data as NxshaFetchOut;
}

export function nxshaResultToMovies(
  result: NxshaFetchOut,
  opts: {
    providerId?: string; // default "nxsha"
    customTemplate?: string;
    markAnime?: boolean; // genre me "Anime" prepend (Anime category ke liye)
    selectedSeasons?: Set<number>; // default: sab
  } = {},
): Movie[] {
  const providerId = opts.providerId || "nxsha";
  const provider = getProvider(providerId);
  const template = provider ? provider.template : (opts.customTemplate || "").trim();
  if (!template || !result.tmdbId) return [];

  const playlistId = `${NXSHA_TV_PREFIX}${result.tmdbId}`;
  const playlistTitle = result.title;
  const baseGenres = result.genres.length > 0 ? result.genres : ["Drama"];
  const genres = opts.markAnime
    ? Array.from(new Set(["Anime", ...baseGenres]))
    : Array.from(new Set(baseGenres));

  const fallbackImg =
    result.poster ||
    "https://images.pexels.com/photos/32728014/pexels-photo-32728014.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";

  const movies: Movie[] = [];
  let id = Date.now();

  for (const season of result.seasons) {
    if (opts.selectedSeasons && !opts.selectedSeasons.has(season.seasonNumber)) continue;
    for (const ep of season.episodes) {
      const embedUrl = template
        .replace(/\{id\}/g, encodeURIComponent(result.tmdbId))
        .replace(/\{s\}/g, String(season.seasonNumber))
        .replace(/\{e\}/g, String(ep.episodeNumber));
      const image = ep.image || result.poster || fallbackImg;
      const epLabel =
        ep.title && !/^Episode \d+$/i.test(ep.title)
          ? `S${season.seasonNumber}E${ep.episodeNumber} — ${ep.title}`
          : `S${season.seasonNumber}E${ep.episodeNumber}`;
      movies.push({
        id: id++,
        title: `${result.title} ${epLabel}`,
        description: result.overview || "",
        image,
        backdrop: result.backdrop || image,
        thumbnailUrl: image,
        year: ep.aired ? Number(ep.aired.slice(0, 4)) : result.year || new Date().getFullYear(),
        rating: "TV-14",
        duration: ep.runtime || "24m",
        genre: genres,
        match: 95,
        creator: "Nxsha Direct",
        embedUrl,
        embedPlatform: provider ? provider.name : "Nxsha",
        playlistId,
        playlistTitle,
        episodeNumber: ep.episodeNumber,
        seasonNumber: season.seasonNumber,
      });
    }
  }

  return movies;
}
