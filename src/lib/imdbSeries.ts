/**
 * IMDb/TMDB auto-series helpers.
 *
 * Third-party embed APIs (VidSrc, VidLink, MultiEmbed, 2Embed…) turn a single
 * IMDb/TMDB ID into a player for any movie or TV episode:
 *   /embed/tv/{id}/{season}/{episode}   or   ?video_id={id}&s={s}&e={e}
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
    id: "vidsrc",
    name: "VidSrc",
    template: "https://vidsrc.xyz/embed/tv/{id}/{s}/{e}",
    hint: "vidsrc.xyz / vidsrc.to / mirrors — sab ka same format",
  },
  {
    id: "vidlink",
    name: "VidLink",
    template: "https://vidlink.pro/tv/{id}/{s}/{e}",
    hint: "vidlink.pro — clean player, IMDb/TMDB dono",
  },
  {
    id: "multiembed",
    name: "MultiEmbed",
    template: "https://multiembed.mov/?video_id={id}&s={s}&e={e}",
    hint: "multiembed.mov (SuperEmbed) — IMDb ID best",
  },
  {
    id: "twoembed",
    name: "2Embed",
    template: "https://www.2embed.cc/embedtv/{id}&s={s}&e={e}",
    hint: "2embed.cc — sirf IMDb ID",
  },
  {
    id: "apiplayer",
    name: "APIPlayer",
    template: "https://apiplayer.ru/embed/tv/{id}/{s}/{e}",
    hint: "apiplayer.ru — IMDb/TMDB dono",
  },
  {
    id: "videm",
    name: "VIDEM",
    template: "https://videm.xyz/embed/tv/{id}/{s}/{e}",
    hint: "videm.xyz — IMDb/TMDB dono",
  },
  {
    id: "vidsrc-to",
    name: "VidSrc.to",
    template: "https://vidsrc.to/embed/tv/{id}/{s}/{e}",
    hint: "original vidsrc.to mirror",
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
  if (lower.includes("vidlink")) return getProvider("vidlink") ?? null;
  if (lower.includes("multiembed")) return getProvider("multiembed") ?? null;
  if (lower.includes("2embed")) return getProvider("twoembed") ?? null;
  if (lower.includes("apiplayer")) return getProvider("apiplayer") ?? null;
  if (lower.includes("videm")) return getProvider("videm") ?? null;
  if (lower.includes("vidsrc") || lower.includes("vid-src")) return getProvider("vidsrc") ?? null;
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

/** Expand a provider template into every (season, episode) URL. Max 500. */
export function buildImdbSeries(
  template: string,
  id: string,
  seasons: number,
  episodesPerSeason: number,
): { ok: boolean; episodes?: GeneratedEpisode[]; reason?: "bad-template" | "too-many" } {
  if (!template.includes("{id}") || !template.includes("{s}") || !template.includes("{e}")) {
    return { ok: false, reason: "bad-template" };
  }
  const total = seasons * episodesPerSeason;
  if (!Number.isFinite(total) || seasons < 1 || episodesPerSeason < 1 || total > 500) {
    return { ok: false, reason: "too-many" };
  }
  const episodes: GeneratedEpisode[] = [];
  for (let s = 1; s <= Math.floor(seasons); s++) {
    for (let e = 1; e <= Math.floor(episodesPerSeason); e++) {
      episodes.push({
        season: s,
        episode: e,
        url: template
          .replace(/\{id\}/g, encodeURIComponent(id))
          .replace(/\{s\}/g, String(s))
          .replace(/\{e\}/g, String(e)),
      });
    }
  }
  return { ok: true, episodes };
}
