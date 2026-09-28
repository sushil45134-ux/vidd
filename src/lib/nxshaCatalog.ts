import type { Movie } from "../data";

/** Nxsha is authoritative for playable season/episode topology. */
export interface NxshaCatalogSeason {
  seasonNumber: number;
  episodeNumbers: number[];
}

export interface NxshaCatalog {
  requestedId: string;
  mediaId?: string;
  seasons: NxshaCatalogSeason[];
  totalEpisodes: number;
  sourceUrl: string;
}

const NXSHA_HOSTS = ["https://web.nxsha.app", "https://nxsha.space"];
const catalogCache = new Map<string, { expiresAt: number; catalog: NxshaCatalog }>();

export function extractNxshaMediaId(url?: string): string | null {
  if (!url || !/nxsha/i.test(url)) return null;
  const match = url.match(/\/tv\/([^/?#]+)\/\d+\/\d+/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Parse Nxsha's server-rendered title response. Episode links are emitted as
 * /watch/tv/{tmdbId}/{season}/{episode}; parsing those links means AniList and
 * Jikan can never create a season/episode that Nxsha did not return.
 */
export function parseNxshaCatalogHtml(
  html: string,
  requestedId: string,
  sourceUrl = "",
): NxshaCatalog | null {
  const normalized = html
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  const pattern = /\/watch\/tv\/([^/"'?#\\]+)\/(\d+)\/(\d+)(?=[?"'#<\\/]|$)/gi;
  const seasons = new Map<number, Set<number>>();
  let mediaId: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized))) {
    const season = Number(match[2]);
    const episode = Number(match[3]);
    if (!Number.isSafeInteger(season) || season < 0) continue;
    if (!Number.isSafeInteger(episode) || episode < 1) continue;
    mediaId ||= match[1];
    if (!seasons.has(season)) seasons.set(season, new Set());
    seasons.get(season)!.add(episode);
  }

  // Nxsha server-renders the selected season's links and serializes the full
  // title response (TMDB-style season_number + episode_count) into its page
  // payload. Read those declared seasons too, so multi-season shows are not
  // accidentally reduced to whichever season Nxsha initially rendered.
  const declaredPatterns = [
    /"season_number"\s*:\s*(\d+)[^{}]{0,1200}?"episode_count"\s*:\s*(\d+)/gi,
    /"episode_count"\s*:\s*(\d+)[^{}]{0,1200}?"season_number"\s*:\s*(\d+)/gi,
  ];
  declaredPatterns.forEach((declared, patternIndex) => {
    let item: RegExpExecArray | null;
    while ((item = declared.exec(normalized))) {
      const season = Number(item[patternIndex === 0 ? 1 : 2]);
      const count = Number(item[patternIndex === 0 ? 2 : 1]);
      if (!Number.isSafeInteger(season) || season < 0) continue;
      if (!Number.isSafeInteger(count) || count < 1 || count > 2000) continue;
      if (!seasons.has(season)) seasons.set(season, new Set());
      for (let episode = 1; episode <= count; episode++) seasons.get(season)!.add(episode);
    }
  });
  if (seasons.size === 0) return null;
  const parsed = [...seasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, episodes]) => ({
      seasonNumber,
      episodeNumbers: [...episodes].sort((a, b) => a - b),
    }));
  return {
    requestedId,
    mediaId,
    seasons: parsed,
    totalEpisodes: parsed.reduce((total, season) => total + season.episodeNumbers.length, 0),
    sourceUrl,
  };
}

export async function fetchNxshaCatalog(id: string): Promise<NxshaCatalog> {
  const cleanId = id.trim();
  if (!/^(?:tt\d{6,10}|\d{1,10})$/i.test(cleanId)) {
    throw new Error(`Invalid IMDb/TMDB ID: ${id}`);
  }
  const cached = catalogCache.get(cleanId);
  if (cached && cached.expiresAt > Date.now()) return cached.catalog;
  let lastError = "Nxsha title response did not contain episodes";
  for (const host of NXSHA_HOSTS) {
    const sourceUrl = `${host}/tv/${encodeURIComponent(cleanId)}`;
    try {
      const response = await fetch(sourceUrl, {
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (compatible; vid-nxsha-catalog/1.0)",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        lastError = `Nxsha returned HTTP ${response.status}`;
        continue;
      }
      const catalog = parseNxshaCatalogHtml(
        await response.text(),
        cleanId,
        response.url || sourceUrl,
      );
      if (catalog) {
        catalogCache.set(cleanId, { expiresAt: Date.now() + 30 * 60_000, catalog });
        return catalog;
      }
      lastError = "Nxsha response contained no season/episode links";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Nxsha request failed";
    }
  }
  throw new Error(lastError);
}

function stableVirtualId(playlistId: string, season: number, episode: number): number {
  const value = `${playlistId}:${season}:${episode}`;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return -(Math.abs(hash) + 1);
}

function replaceSeasonEpisode(
  url: string | undefined,
  season: number,
  episode: number,
): string | undefined {
  return url?.replace(/(\/tv\/[^/?#]+\/)\d+\/\d+/i, `$1${season}/${episode}`);
}

/**
 * Rebuild every Nxsha anime playlist from provider topology. Existing rows are
 * reused only for metadata; extra AniList/Jikan rows are dropped and provider
 * episodes missing from the DB are represented by deterministic virtual rows.
 */
export function reconcileMoviesWithNxsha(
  movies: Movie[],
  catalogs: Readonly<Record<string, NxshaCatalog | null | undefined>>,
): Movie[] {
  const groups = new Map<string, Movie[]>();
  for (const movie of movies) {
    if (!movie.playlistId) continue;
    if (!movie.genre.some((genre) => genre.toLowerCase() === "anime")) continue;
    const id = extractNxshaMediaId(movie.embedUrl);
    if (!id) continue;
    if (!groups.has(movie.playlistId)) groups.set(movie.playlistId, []);
    groups.get(movie.playlistId)!.push(movie);
  }
  if (groups.size === 0) return movies;

  const output: Movie[] = [];
  const emitted = new Set<string>();
  for (const movie of movies) {
    const playlistId = movie.playlistId;
    const group = playlistId ? groups.get(playlistId) : undefined;
    if (!playlistId || !group) {
      output.push(movie);
      continue;
    }
    if (emitted.has(playlistId)) continue;
    emitted.add(playlistId);

    const id = group.map((row) => extractNxshaMediaId(row.embedUrl)).find(Boolean);
    if (!id) continue;
    const catalog = catalogs[id];
    // undefined = still loading; null = provider failed/not found. Fail closed:
    // an unverified Nxsha episode must never appear on the website.
    if (!catalog) continue;

    const sortedRows = [...group].sort(
      (a, b) =>
        (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1) ||
        (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
    );
    const metadataSeasons = [...new Set(sortedRows.map((row) => row.seasonNumber ?? 1))].sort(
      (a, b) => a - b,
    );
    const topologyAligned =
      metadataSeasons.length === catalog.seasons.length &&
      catalog.seasons.every((season) => metadataSeasons.includes(season.seasonNumber));
    let providerOffset = 0;

    catalog.seasons.forEach((providerSeason, seasonIndex) => {
      const metadataSeason = topologyAligned
        ? providerSeason.seasonNumber
        : (metadataSeasons[seasonIndex] ?? metadataSeasons[0]);
      const seasonRows = sortedRows.filter((row) => (row.seasonNumber ?? 1) === metadataSeason);
      providerSeason.episodeNumbers.forEach((episodeNumber, episodeIndex) => {
        const exact = sortedRows.find(
          (row) =>
            (row.seasonNumber ?? 1) === providerSeason.seasonNumber &&
            row.episodeNumber === episodeNumber,
        );
        const metadata = topologyAligned
          ? seasonRows.find((row) => row.episodeNumber === episodeNumber) || exact || seasonRows[0]
          : sortedRows[providerOffset + episodeIndex] || seasonRows[0] || sortedRows[0];
        if (!metadata) return;
        output.push({
          ...metadata,
          id: exact?.id ?? stableVirtualId(playlistId, providerSeason.seasonNumber, episodeNumber),
          title:
            (topologyAligned ? exact?.title : metadata.title) ||
            `${metadata.playlistTitle || metadata.title} - Episode ${episodeNumber}`,
          embedUrl: replaceSeasonEpisode(
            metadata.embedUrl,
            providerSeason.seasonNumber,
            episodeNumber,
          ),
          seasonNumber: providerSeason.seasonNumber,
          episodeNumber,
        });
      });
      providerOffset += providerSeason.episodeNumbers.length;
    });
  }
  return output;
}
