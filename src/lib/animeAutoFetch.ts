/**
 * Anime Auto-Fetch via AniList + Jikan (no API key needed)
 * 
 * Flow:
 * 1. User enters anime name + optional IMDb ID (tt...)
 * 2. Client calls /api/anime-auto?title=...
 * 3. Server searches AniList, gets relations for seasons, fetches Jikan episodes
 * 4. Returns structured seasons/episodes with images
 * 5. Client converts to Movie[] with NHD/Nxsha embed URLs
 */

import type { Movie } from "../data";
import { IMDB_PROVIDERS, buildImdbSeries, getProvider } from "./imdbSeries";
import { youtubeThumbnailSources } from "./media";

export interface AutoFetchEpisode {
  episodeNumber: number;
  title: string;
  titleJapanese?: string;
  synopsis?: string;
  aired?: string;
  duration?: string;
  image: string; // episode thumbnail
  filler?: boolean;
  recap?: boolean;
}

export interface AutoFetchSeason {
  seasonNumber: number;
  title: string;
  titleEnglish?: string;
  titleNative?: string;
  description: string;
  coverImage: string;
  bannerImage: string;
  year?: number;
  season?: string;
  episodesCount: number;
  averageScore?: number;
  genres: string[];
  studios: string[];
  anilistId: number;
  malId?: number;
  format?: string;
  episodes: AutoFetchEpisode[];
}

export interface AutoFetchResult {
  query: string;
  imdbId?: string;
  autoResolvedImdb?: string;
  imdbAutoResolved?: boolean;
  mainTitle: string;
  mainCover: string;
  mainBanner: string;
  description: string;
  genres: string[];
  totalSeasons: number;
  totalEpisodes: number;
  seasons: AutoFetchSeason[];
  source: "anilist+jikan" | "anilist" | "jikan" | "static-fallback";
}

export interface FetchAnimeOptions {
  title: string;
  imdbId?: string;
  provider?: string; // nhd | nxsha | custom
  customTemplate?: string;
}

/**
 * Convert AutoFetchResult + IMDb provider into Movie[] ready for upload
 */
export function autoFetchToMovies(
  result: AutoFetchResult,
  opts: { imdbId: string; providerId: string; customTemplate?: string }
): Movie[] {
  const { imdbId, providerId, customTemplate } = opts;
  const provider = getProvider(providerId);
  const template = provider ? provider.template : customTemplate || "";

  if (!template || !imdbId) return [];

  // Deterministic playlistId based on mainTitle slug + imdbId, so S1 and S2 fetched separately still merge into same collection
  const slug = result.mainTitle.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "anime";
  const playlistId = `anime-auto-${slug}-${imdbId}`;
  const playlistTitle = result.mainTitle;

  const movies: Movie[] = [];
  const fallbackImg =
    "https://images.pexels.com/photos/32728014/pexels-photo-32728014.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";

  let globalId = Date.now();

  for (const season of result.seasons) {
    const seasonNum = season.seasonNumber;
    const episodesPerSeason = season.episodes.length || season.episodesCount || 12;
    // Always include Anime genre so it shows in Anime category, not Movies
    const baseGenres = season.genres.length > 0 ? season.genres : result.genres;
    const seasonGenres = Array.from(new Set(["Anime", ...baseGenres]));

    // Build URLs via provider template (same logic as imdbSeries)
    const built = buildImdbSeries(template, imdbId, 1, episodesPerSeason);
    // We'll generate per season, but need to offset season number
    // So manually build URLs for this season
    for (let i = 0; i < season.episodes.length; i++) {
      const ep = season.episodes[i];
      const epNum = ep.episodeNumber;
      const embedUrl = template
        .replace(/\{id\}/g, encodeURIComponent(imdbId))
        .replace(/\{s\}/g, String(seasonNum))
        .replace(/\{e\}/g, String(epNum));

      const epImage = ep.image || season.coverImage || result.mainCover || fallbackImg;

      movies.push({
        id: globalId++,
        title: ep.title ? `${season.title} - ${ep.title}` : `${season.title} Episode ${epNum}`,
        description: ep.synopsis || season.description || result.description || "",
        image: epImage,
        backdrop: season.bannerImage || result.mainBanner || epImage,
        thumbnailUrl: epImage,
        year: season.year || new Date().getFullYear(),
        rating: "TV-14",
        duration: ep.duration || season.format || "24m",
        genre: seasonGenres,
        match: season.averageScore || 95,
        cast: season.studios.length > 0 ? season.studios : ["Anime Studio"],
        creator: season.studios[0] || "Anime",
        embedUrl,
        embedPlatform: provider ? provider.name : "NHD",
        playlistId,
        playlistTitle,
        episodeNumber: epNum,
        seasonNumber: seasonNum,
      });
    }

    // If Jikan returned 0 episodes but we know count, generate placeholders
    if (season.episodes.length === 0 && season.episodesCount > 0) {
      for (let epNum = 1; epNum <= season.episodesCount; epNum++) {
        const embedUrl = template
          .replace(/\{id\}/g, encodeURIComponent(imdbId))
          .replace(/\{s\}/g, String(seasonNum))
          .replace(/\{e\}/g, String(epNum));

        const epImage = season.coverImage || result.mainCover || fallbackImg;

        movies.push({
          id: globalId++,
          title: `${season.title} Episode ${epNum}`,
          description: season.description || result.description || "",
          image: epImage,
          backdrop: season.bannerImage || result.mainBanner || epImage,
          thumbnailUrl: epImage,
          year: season.year || new Date().getFullYear(),
          rating: "TV-14",
          duration: "24m",
          genre: seasonGenres,
          match: season.averageScore || 95,
          cast: season.studios,
          creator: season.studios[0] || "Anime",
          embedUrl,
          embedPlatform: provider ? provider.name : "NHD",
          playlistId,
          playlistTitle,
          episodeNumber: epNum,
          seasonNumber: seasonNum,
        });
      }
    }
  }

  // If no seasons built (edge), try simple generation from total episodes
  if (movies.length === 0 && result.totalEpisodes > 0) {
    const built = buildImdbSeries(template, imdbId, result.totalSeasons || 1, Math.ceil(result.totalEpisodes / (result.totalSeasons || 1)));
    if (built.ok && built.episodes) {
      for (const gen of built.episodes) {
        const season = result.seasons.find((s) => s.seasonNumber === gen.season) || result.seasons[0];
        const cover = season?.coverImage || result.mainCover || fallbackImg;
        const fallbackGenres = season ? Array.from(new Set(["Anime", ...season.genres])) : ["Anime", ...result.genres];
        movies.push({
          id: globalId++,
          title: `${result.mainTitle} Episode ${gen.episode}`,
          description: result.description,
          image: cover,
          backdrop: result.mainBanner || cover,
          thumbnailUrl: cover,
          year: season?.year || new Date().getFullYear(),
          rating: "TV-14",
          duration: "24m",
          genre: fallbackGenres,
          match: 95,
          embedUrl: gen.url,
          embedPlatform: provider ? provider.name : "NHD",
          playlistId,
          playlistTitle,
          episodeNumber: gen.episode,
          seasonNumber: gen.season,
        });
      }
    }
  }

  return movies;
}

// Client helper to call API
export async function fetchAnimeAuto(title: string, imdbId?: string): Promise<AutoFetchResult> {
  const params = new URLSearchParams({ title: title.trim() });
  if (imdbId) params.set("imdbId", imdbId.trim());
  const res = await fetch(`/api/anime-auto?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Fetch failed" }));
    throw new Error(err.error || `Fetch failed: ${res.status}`);
  }
  return (await res.json()) as AutoFetchResult;
}

export const ANIME_PROVIDERS = IMDB_PROVIDERS;
