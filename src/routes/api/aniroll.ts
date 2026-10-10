/* eslint-disable @typescript-eslint/no-explicit-any -- raw Supabase rows are untyped, same as moviesRepo */
import { createFileRoute } from "@tanstack/react-router";
import { episodesToMovies, type AnimeEpisode } from "../../lib/animeCatalog";
import type { Movie } from "../../data";

/**
 * AniRoll catalog bridge — one server-side endpoint that gathers everything the
 * AniRoll UI (public/aniroll/) needs, from the SAME connections vid already uses:
 *
 *   • /api/movies  → Supabase `movies` table (uploaded + synced series & films)
 *   • /api/anime   → official Hindi-dub YouTube feeds (with the seed fallback)
 *
 * The response is shaped for the AniRoll front-end: every "show" has its
 * playable episodes already resolved (youtubeId / embedUrl / videoUrl), plus
 * the home rails, hero and notification list, so the static page stays dumb.
 */

const CACHE_CONTROL = "public, max-age=120, stale-while-revalidate=300";
const PAGE = 1000;
const MAX_ROWS = 20000;

type AniEp = {
  id: string;
  n: number;
  season: number;
  title: string;
  img: string;
  runtime: string;
  youtubeId?: string;
  embedUrl?: string;
  videoUrl?: string;
};

type AniShow = {
  id: string;
  title: string;
  desc: string;
  year: number;
  rating: string;
  stars: number;
  genres: string[];
  type: "TV" | "Movie";
  audio: string;
  img: string;
  backdrop: string;
  runtime: string;
  creator: string;
  source: "anime" | "library";
  updated: number;
  seasons: number[];
  episodes: AniEp[];
};

/* ── Helpers copied from src/lib/moviesRepo.ts so Nxsha rows resolve the same way ── */

function isFranchiseNxshaMovie(r: any): boolean {
  const embed = String(r.embed_url || "");
  const title = String(r.title || "");
  return (
    /nxsha/i.test(embed) &&
    /\/embed\/movie\//i.test(embed) &&
    /doraemon|crayon\s+shin|shinchan|pokemon|pok[eé]mon/i.test(title)
  );
}

function toonstreamVideoUrl(r: any): string {
  const params = new URLSearchParams({
    title: String(r.title || ""),
    year: String(r.year || ""),
  });
  return `/api/toonstream?${params.toString()}`;
}

/* ── Upstream reads (same-origin, reusing the existing proxy routes) ── */

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchMovieRows(origin: string): Promise<Array<Record<string, any>>> {
  const rows: Array<Record<string, any>> = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const page = await fetchJson(`${origin}/api/movies?from=${from}&limit=${PAGE}`);
    const data: Array<Record<string, any>> | undefined = page?.data;
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function fetchAnimeEpisodes(
  origin: string,
): Promise<{ source: string; episodes: AnimeEpisode[] }> {
  const json = await fetchJson(`${origin}/api/anime?limit=500`);
  const episodes: AnimeEpisode[] = Array.isArray(json?.episodes) ? json.episodes : [];
  return { source: typeof json?.source === "string" ? json.source : "unavailable", episodes };
}

/* ── Normalisers ── */

const GENRE_ALIASES: Record<string, string> = {
  "sci-fi": "science-fiction",
  scifi: "science-fiction",
  "science fiction": "science-fiction",
};

function normaliseGenres(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const raw of list) {
    const g = String(raw || "")
      .trim()
      .toLowerCase();
    if (!g) continue;
    out.add(GENRE_ALIASES[g] ?? g.replace(/\s+/g, "-"));
  }
  return [...out];
}

function starsFrom(match: unknown): number {
  const n = Number(match);
  const score = Number.isFinite(n) && n > 0 ? n : 90;
  return Math.round((score / 20) * 10) / 10;
}

function toEp(
  id: string,
  m: Pick<
    Movie,
    "episodeNumber" | "seasonNumber" | "image" | "youtubeId" | "embedUrl" | "videoUrl" | "duration"
  >,
  fallbackN: number,
  title: string,
): AniEp {
  return {
    id,
    n: m.episodeNumber || fallbackN,
    season: m.seasonNumber || 1,
    title,
    img: m.image || "",
    runtime: m.duration || "",
    youtubeId: m.youtubeId || undefined,
    embedUrl: m.youtubeId ? undefined : m.embedUrl || undefined,
    videoUrl: m.youtubeId ? undefined : m.videoUrl || undefined,
  };
}

function finishShow(show: Omit<AniShow, "seasons">): AniShow {
  const seasons = [...new Set(show.episodes.map((e) => e.season))].sort((a, b) => a - b);
  return { ...show, seasons };
}

function rowToShowParts(r: Record<string, any>) {
  const replaceNxsha = isFranchiseNxshaMovie(r);
  return {
    img: String(r.image || r.thumbnail_url || r.backdrop || ""),
    backdrop: String(r.backdrop || r.image || r.thumbnail_url || ""),
    videoUrl: replaceNxsha ? toonstreamVideoUrl(r) : r.video_url || undefined,
    embedUrl: replaceNxsha ? undefined : r.embed_url || undefined,
    youtubeId: r.youtube_id || undefined,
    match: r.match_score,
    replaceNxsha,
  };
}

/* ── Build the AniRoll catalog ── */

function buildLibraryShows(rows: Array<Record<string, any>>): AniShow[] {
  const shows: AniShow[] = [];
  const series = new Map<string, Array<Record<string, any>>>();

  for (const r of rows) {
    if (r.playlist_id) {
      const key = String(r.playlist_id);
      if (!series.has(key)) series.set(key, []);
      series.get(key)!.push(r);
      continue;
    }
    if (r.is_collection) continue; // empty collection header with no episodes
    const parts = rowToShowParts(r);
    if (!parts.youtubeId && !parts.embedUrl && !parts.videoUrl) continue;
    const id = `movie-${r.id}`;
    const episode: AniEp = {
      id: `${id}-ep1`,
      n: 1,
      season: 1,
      title: String(r.title || "Watch"),
      img: parts.img,
      runtime: String(r.duration || ""),
      youtubeId: parts.youtubeId,
      embedUrl: parts.youtubeId ? undefined : parts.embedUrl,
      videoUrl: parts.youtubeId ? undefined : parts.videoUrl,
    };
    shows.push(
      finishShow({
        id,
        title: String(r.title || "Untitled"),
        desc: String(r.description || ""),
        year: Number(r.year) || new Date().getFullYear(),
        rating: String(r.rating || ""),
        stars: starsFrom(parts.match),
        genres: normaliseGenres(r.genre),
        type: "Movie",
        audio: "Hindi / Original",
        img: parts.img,
        backdrop: parts.backdrop,
        runtime: String(r.duration || ""),
        creator: String(r.creator || ""),
        source: "library",
        updated: Date.parse(r.created_at || "") || 0,
        episodes: [episode],
      }),
    );
  }

  for (const [playlistId, list] of series) {
    const sorted = [...list].sort(
      (a, b) =>
        (Number(a.season_number) || 1) - (Number(b.season_number) || 1) ||
        (Number(a.episode_number) || 0) - (Number(b.episode_number) || 0),
    );
    const eps: AniEp[] = [];
    sorted.forEach((r, i) => {
      const parts = rowToShowParts(r);
      if (!parts.youtubeId && !parts.embedUrl && !parts.videoUrl) return;
      const m = {
        episodeNumber: Number(r.episode_number) || undefined,
        seasonNumber: Number(r.season_number) || undefined,
        image: parts.img,
        youtubeId: parts.youtubeId,
        embedUrl: parts.embedUrl,
        videoUrl: parts.videoUrl,
        duration: String(r.duration || ""),
      };
      eps.push(toEp(`m-${r.id}`, m, i + 1, `Episode ${m.episodeNumber || i + 1}`));
    });
    if (eps.length === 0) continue;
    const head = sorted[0];
    const headParts = rowToShowParts(head);
    shows.push(
      finishShow({
        id: `series-${playlistId}`,
        title: String(head.playlist_title || head.title || "Series"),
        desc: String(head.description || ""),
        year: Number(head.year) || new Date().getFullYear(),
        rating: String(head.rating || ""),
        stars: starsFrom(headParts.match),
        genres: normaliseGenres(head.genre),
        type: "TV",
        audio: "Sub & Dub",
        img: headParts.img,
        backdrop: headParts.backdrop,
        runtime: "",
        creator: String(head.creator || ""),
        source: "library",
        updated: Math.max(...sorted.map((r) => Date.parse(r.created_at || "") || 0)),
        episodes: eps,
      }),
    );
  }

  return shows;
}

function buildAnimeShows(episodes: AnimeEpisode[]): AniShow[] {
  const { series } = episodesToMovies(episodes);
  // Anime episodes carry their YouTube publish time on the raw feed entry.
  const publishedByVideo = new Map<string, number>();
  for (const ep of episodes) publishedByVideo.set(ep.videoId, Date.parse(ep.published || "") || 0);
  return series
    .filter((s) => (s.episodes?.length ?? 0) > 0)
    .map((s) => {
      const eps: AniEp[] = (s.episodes ?? []).map((m, i) =>
        toEp(`a-${m.id}`, m, i + 1, `Episode ${m.episodeNumber || i + 1}`),
      );
      return finishShow({
        id: String(s.playlistId), // already "anime:<slug>"
        title: s.title,
        desc: s.description,
        year: s.year,
        rating: s.rating,
        stars: starsFrom(s.match),
        genres: ["anime"],
        type: "TV",
        audio: "Hindi Dub",
        img: s.image,
        backdrop: s.backdrop || s.image,
        runtime: "",
        creator: s.creator || "",
        source: "anime",
        updated: Math.max(
          0,
          ...(s.episodes ?? []).map((m) => publishedByVideo.get(String(m.youtubeId)) ?? 0),
        ),
        episodes: eps,
      });
    });
}

/** Show ids end up in HTML attributes on the static page — keep them plain and unique. */
function sanitizeIds(list: AniShow[]) {
  const seen = new Map<string, number>();
  for (const s of list) {
    const base =
      s.id
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120) || "show";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    s.id = n ? `${base}-${n}` : base;
  }
}

export function buildAniRollCatalog(
  animeEpisodes: AnimeEpisode[],
  movieRows: Array<Record<string, any>>,
  animeSource: string,
) {
  const shows = [...buildAnimeShows(animeEpisodes), ...buildLibraryShows(movieRows)];
  sanitizeIds(shows);

  // Rank: best rating first, then bigger series.
  const ranked = [...shows].sort(
    (a, b) =>
      b.stars - a.stars || b.episodes.length - a.episodes.length || a.title.localeCompare(b.title),
  );
  const pick = (list: AniShow[], n: number) => list.slice(0, n).map((s) => s.id);

  const rows: Array<{ title: string; ranked?: boolean; keys: string[] }> = [];
  const top10 = pick(ranked, 10);
  if (top10.length) rows.push({ title: "Top 10 on AniRoll", ranked: true, keys: top10 });

  const newest = [...shows].sort((a, b) => b.updated - a.updated);
  const newestIds = pick(newest, 12);
  if (newestIds.length) rows.push({ title: "New Episodes", keys: newestIds });

  const hindi = pick(
    ranked.filter((s) => s.source === "anime"),
    12,
  );
  if (hindi.length) rows.push({ title: "Hindi Dub Series", keys: hindi });

  const library = pick(
    ranked.filter((s) => s.source === "library" && s.type === "TV"),
    12,
  );
  if (library.length) rows.push({ title: "Series Library", keys: library });

  const movies = ranked.filter((s) => s.type === "Movie");
  if (movies.length) rows.push({ title: "Movies", keys: pick(movies, 12) });

  const hero = ranked.find((s) => s.type === "TV" && s.backdrop) ?? ranked[0] ?? null;

  return {
    ok: true,
    source: {
      anime: animeSource,
      animeEpisodes: animeEpisodes.length,
      libraryRows: movieRows.length,
    },
    hero: hero?.id ?? null,
    shows,
    rows,
    movieIds: movies.map((s) => s.id),
    newest: newestIds,
  };
}

export const Route = createFileRoute("/api/aniroll")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        try {
          const [movieRows, anime] = await Promise.all([
            fetchMovieRows(origin),
            fetchAnimeEpisodes(origin),
          ]);
          const payload = buildAniRollCatalog(anime.episodes, movieRows, anime.source);
          return Response.json(payload, { headers: { "cache-control": CACHE_CONTROL } });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "catalog failed" },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
