/**
 * IMDb/TMDB auto-series helpers.
 *
 * NHD and Nxsha turn a single IMDb/TMDB ID into a player for any TV episode:
 *   https://nhdapi.com/tv/{id}/{s}/{e}
 *   https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true
 */

export interface ImdbProvider {
  id: string;
  name: string;
  /** URL template with {id}, {s} and {e} placeholders. */
  template: string;
  hint: string;
}

export const IMDB_PROVIDERS: ImdbProvider[] = [
  {
    id: "nhd",
    name: "NHD",
    template: "https://nhdapi.com/tv/{id}/{s}/{e}",
    hint: "nhdapi.com — IMDb/TMDB ID se har episode",
  },
  {
    id: "nxsha",
    name: "Nxsha",
    template:
      "https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true",
    hint: "Hindi audio verified by user; popup risk accepted",
  },
];

export const CUSTOM_PROVIDER_ID = "custom";

export function getProvider(id: string): ImdbProvider | undefined {
  return IMDB_PROVIDERS.find((p) => p.id === id);
}

/** Pull an IMDb ID (tt + 6-10 digits) out of any pasted text/embed. */
export function extractImdbId(input: string): string | null {
  const m = input.match(/\btt(\d{6,10})\b/);
  return m ? m[0] : null;
}

/** Detect S02E07 / s2e7 / 2x07 or path form /tv/{id}/{s}/{e}. */
export function detectSeasonEpisode(url: string): { season: number; episode: number } | null {
  const se = url.match(/\bs(\d{1,2})[-_.]?e(\d{1,3})\b/i);
  if (se) return { season: parseInt(se[1], 10), episode: parseInt(se[2], 10) };
  const x = url.match(/\/(\d{1,2})[-_.]x(\d{1,3})\b/);
  if (x) return { season: parseInt(x[1], 10), episode: parseInt(x[2], 10) };
  const path = url.match(/\/tv\/[^/]+\/(\d{1,3})\/(\d{1,3})\b/);
  if (path) return { season: parseInt(path[1], 10), episode: parseInt(path[2], 10) };
  return null;
}

/** Guess a provider preset from a pasted embed/URL host. */
export function detectProviderFromEmbed(input: string): ImdbProvider | null {
  const lower = input.toLowerCase();
  if (lower.includes("web.nxsha.app") || lower.includes("nxsha.space") || lower.includes("nxsha"))
    return getProvider("nxsha") ?? null;
  if (lower.includes("nhdapi.com") || lower.includes("nhdapi")) return getProvider("nhd") ?? null;
  return null;
}

/** True when a URL is just a bare domain root (no path/query/hash/id). */
export function isBareRootUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === "" || u.pathname === "/") && !u.search && !u.hash;
  } catch {
    return false;
  }
}

export interface GeneratedEpisode {
  season: number;
  episode: number;
  url: string;
}

/**
 * Expand a provider template into every (season, episode) URL. Max 500.
 *
 * `episodesPerSeason` is either a uniform count (rectangular grid, manual
 * mode) or a per-season array from the real show structure (MAL/AniList), e.g.
 * [12, 24] → S1E1..S1E12 then S2E1..S2E24.
 */
export function buildImdbSeries(
  template: string,
  id: string,
  seasons: number,
  episodesPerSeason: number | number[],
): { ok: boolean; episodes?: GeneratedEpisode[]; reason?: "bad-template" | "too-many" } {
  if (!template.includes("{id}") || !template.includes("{s}") || !template.includes("{e}")) {
    return { ok: false, reason: "bad-template" };
  }
  const perSeason = Array.isArray(episodesPerSeason)
    ? episodesPerSeason.map((n) => Math.max(0, Math.floor(n)))
    : Array.from({ length: Math.max(1, Math.floor(seasons)) }, () =>
        Math.max(1, Math.floor(episodesPerSeason)),
      );
  if (perSeason.length === 0 || perSeason.some((n) => n < 1)) {
    return { ok: false, reason: "too-many" };
  }
  const total = perSeason.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total > 500) {
    return { ok: false, reason: "too-many" };
  }
  const episodes: GeneratedEpisode[] = [];
  perSeason.forEach((count, i) => {
    const s = i + 1;
    for (let e = 1; e <= count; e++) {
      episodes.push({
        season: s,
        episode: e,
        url: template
          .replace(/\{id\}/g, encodeURIComponent(id))
          .replace(/\{s\}/g, String(s))
          .replace(/\{e\}/g, String(e)),
      });
    }
  });
  return { ok: true, episodes };
}

/* ── Anime series structure (seasons × episodes + stills, keyless) ── */
/**
 * Fetched from the /api/anime-series server route. Primary source is Jikan
 * (MyAnimeList — real season chain + each episode's own still image);
 * fallback is AniList (season chain + counts, no stills). Both are free and
 * need NO API key. One entry per real season — this auto-fills the upload
 * form and pictures every episode row.
 */
export interface AnimeEpisode {
  episode: number;
  name?: string;
  /** Per-episode still (Jikan only; AniList fallback has none). */
  still?: string;
}

export interface AnimeSeason {
  season: number;
  episodes: AnimeEpisode[];
}

export interface AnimeShowInfo {
  source: "jikan" | "anilist";
  /** MAL id (Jikan) or AniList id. */
  externalId: number;
  name: string;
  firstYear?: number;
  totalEpisodes: number;
  seasons: AnimeSeason[];
  posterUrl?: string;
  backdropUrl?: string;
  /** 500-episode cap hit — the rest goes in via "Add to Existing Series". */
  truncated?: boolean;
}

export function totalAnimeEpisodes(info: AnimeShowInfo): number {
  return info.seasons.reduce((sum, s) => sum + s.episodes.length, 0);
}

/**
 * Resolve an anime's full structure from the server-side Jikan/AniList route.
 * Throws an Error whose `code` is "not-found" | "upstream" | "network" and
 * which may carry `suggestions` (search candidates to try instead).
 */
export async function fetchAnimeSeriesInfo(opts: {
  q: string;
  imdb?: string | null;
}): Promise<AnimeShowInfo> {
  const params = new URLSearchParams();
  params.set("q", opts.q);
  if (opts.imdb) params.set("imdb", opts.imdb);
  let res: Response;
  try {
    res = await fetch(`/api/anime-series?${params.toString()}`);
  } catch {
    const err = new Error("Server se connect nahi hua — internet/preview check karo.") as Error & {
      code?: string;
    };
    err.code = "network";
    throw err;
  }
  let data:
    | (AnimeShowInfo & {
        ok?: boolean;
        error?: string;
        message?: string;
        suggestions?: string[];
      })
    | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.ok !== true) {
    const err = new Error(
      (data && data.message) || `Server ${res.status} se jawab nahi diya.`,
    ) as Error & { code?: string; suggestions?: string[] };
    err.code = (data && data.error) || "upstream";
    err.suggestions = data?.suggestions;
    throw err;
  }
  return data;
}
