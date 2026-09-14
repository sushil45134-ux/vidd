import { createFileRoute } from "@tanstack/react-router";

/**
 * Server-side anime-series structure fetcher for the "IMDb Auto-Series"
 * upload flow — NO API KEY needed.
 *
 * Primary source: Jikan (MyAnimeList, REST, free, keyless). Gives the real
 * season chain (follows MAL's SEQUEL relations — season 2/3 live as separate
 * entries) and the per-episode guide WITH each episode's own still image.
 * Fallback source: AniList (GraphQL, free, keyless) when Jikan is
 * rate-limited/down — season chain + counts, but no per-episode stills.
 *
 * The admin pastes the anime's English name (+ the IMDb ID used by the NHD /
 * Nxsha provider links); this route answers with:
 *   { seasons: [{ season, episodes: [{ episode, name?, still? }] }], … }
 * so the upload form can auto-fill seasons/episodes and picture every row.
 *
 * Runs server-side (like /api/anime) so there is no CORS and the request
 * comes from our worker IP. Jikan allows ~60 req/min and 3 req/s per IP —
 * we stagger calls and cache results for 6 hours.
 */

const JIKAN_BASE =
  (import.meta.env.VITE_JIKAN_BASE_URL as string | undefined) || "https://api.jikan.moe/v4";
const ANILIST_URL =
  (import.meta.env.VITE_ANILIST_URL as string | undefined) || "https://graphql.anilist.co";

const MAX_SEASON_HOPS = 12;
const MAX_EPISODES = 500;
const JIKAN_STAGGER_MS = 350; // stay under Jikan's 3 req/s
const OK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_CACHE_TTL_MS = 10 * 60 * 1000;

interface AnimeEpisode {
  episode: number;
  name?: string;
  still?: string;
}

interface AnimeSeason {
  season: number;
  episodes: AnimeEpisode[];
}

interface AnimeShowInfo {
  source: "jikan" | "anilist";
  /** MAL id (Jikan) or AniList id. */
  externalId: number;
  name: string;
  firstYear?: number;
  totalEpisodes: number;
  seasons: AnimeSeason[];
  posterUrl?: string;
  backdropUrl?: string;
  /** True when the 500-episode cap was hit (add the rest via existing series). */
  truncated?: boolean;
  /** Search candidates shown when nothing matched. */
  suggestions?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a hard timeout (older TV/worker runtimes lack AbortSignal.timeout). */
async function fetchTimeout(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface UpstreamError extends Error {
  status?: number;
  /** 429 / 5xx / network — safe to fall back to the other source. */
  fallbackable?: boolean;
  suggestions?: string[];
}

function upstreamError(message: string, status?: number, fallbackable = false): UpstreamError {
  return Object.assign(new Error(message), { status, fallbackable });
}

/* ── Jikan (MyAnimeList) ─────────────────────────────────────────── */

interface JikanAnime {
  mal_id: number;
  media_type?: string;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  episode?: number | null;
  year?: number | null;
  images?: { jpg?: { large_image_url?: string; image_url?: string } };
  related?: { relation: string; entry: JikanAnime }[];
}

interface JikanEpGuide {
  mal_id?: number;
  title?: string;
  image?: { image_url?: string; small_image_url?: string } | null;
}

const norm = (s: string | null | undefined): string =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** 0 = no match; higher = better. Prefers the english/romaji title. */
function scoreTitle(query: string, cand: JikanAnime | { title?: string | null }): number {
  const q = norm(query);
  if (!q) return 0;
  const names: (string | null | undefined)[] =
    "title_english" in cand ? [cand.title_english, cand.title, cand.title_japanese] : [cand.title];
  let best = 0;
  for (const raw of names) {
    const n = norm(raw);
    if (!n) continue;
    let s = 0;
    if (n === q) s = 100;
    else if (n.startsWith(q) || q.startsWith(n)) s = 70 + Math.min(n.length, q.length) / 20;
    else if (n.includes(q)) s = 40 + Math.min(n.length, q.length) / 20;
    else {
      const qw = q.split(" ").filter((w) => w.length > 1);
      if (qw.length > 0) {
        const cw = new Set(n.split(" "));
        const hit = qw.filter((w) => cw.has(w)).length;
        if (hit === qw.length) s = 25;
      }
    }
    if (s > best) best = s;
  }
  return best;
}

async function jikanGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetchTimeout(`${JIKAN_BASE}${path}`, {
      headers: { accept: "application/json", "user-agent": "vidd-anime-series/1.0" },
    });
  } catch {
    throw upstreamError("jikan network", undefined, true);
  }
  if (res.status === 429 || res.status >= 500) {
    throw upstreamError(`jikan ${res.status}`, res.status, true);
  }
  if (!res.ok) throw upstreamError(`jikan ${res.status}`, res.status, false);
  return (await res.json()) as T;
}

const CHAIN_SKIP_TYPES = new Set(["movie", "music", "special"]);

async function fetchViaJikan(title: string): Promise<AnimeShowInfo> {
  const search = await jikanGet<{ data?: JikanAnime[] }>(
    `/anime?q=${encodeURIComponent(title)}&limit=15&sfw=true`,
  );
  const items = (search.data || []).filter(
    (i) => i.mal_id && !CHAIN_SKIP_TYPES.has(i.media_type || ""),
  );
  const suggestions = (search.data || [])
    .slice(0, 4)
    .map((i) => i.title_english || i.title)
    .filter(Boolean) as string[];
  if (items.length === 0) throw Object.assign(upstreamError("not-found"), { suggestions });

  const scored = items
    .map((i) => ({ i, s: scoreTitle(title, i) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const best = scored[0]?.i || items[0];

  // Season chain: MAL keeps "Season 2" etc. as SEPARATE entries linked by
  // SEQUEL relations. Movies can sit IN the chain (S1 → movie → S2) — walk
  // through them but only emit real TV seasons.
  const chain: number[] = [best.mal_id];
  const seen = new Set<number>([best.mal_id]);
  let pending: number[] = [best.mal_id];
  let base: JikanAnime | undefined;
  while (pending.length > 0 && chain.length < MAX_SEASON_HOPS) {
    const current = pending.pop()!;
    const full = await jikanGet<{ data?: JikanAnime }>(`/anime/${current}/full`);
    await sleep(JIKAN_STAGGER_MS);
    if (current === best.mal_id) base = full.data;
    const rel = (full.data?.related || []).filter(
      (r) =>
        r.relation === "SEQUEL" &&
        r.entry.mal_id &&
        !CHAIN_SKIP_TYPES.has(r.entry.media_type || ""),
    );
    // Some seasons sit behind a movie on MAL (S1 → movie → S2): walk through
    // movie nodes to find the next real season, but only emit non-movies.
    const movieRel = (full.data?.related || []).filter(
      (r) => r.relation === "SEQUEL" && r.entry.mal_id && (r.entry.media_type || "") === "movie",
    );
    const next: number[] = [];
    for (const r of [...rel, ...movieRel]) {
      if (seen.has(r.entry.mal_id)) continue;
      seen.add(r.entry.mal_id);
      next.push(r.entry.mal_id);
      if (!movieRel.includes(r)) chain.push(r.entry.mal_id);
    }
    pending = pending.concat(next);
  }

  const seasons: AnimeSeason[] = [];
  let total = 0;
  let truncated = false;
  for (const sid of chain) {
    if (total >= MAX_EPISODES) break;
    const guide = await jikanGet<{ data?: JikanEpGuide[] }>(`/anime/${sid}/episodes`);
    await sleep(JIKAN_STAGGER_MS);
    const eps: AnimeEpisode[] = (guide.data || []).map((e, i) => ({
      episode: i + 1,
      name: e.title && e.title.trim() ? e.title.trim() : undefined,
      still: e.image?.image_url || undefined,
    }));
    if (eps.length === 0) continue;
    const slice = eps.slice(0, MAX_EPISODES - total);
    if (slice.length < eps.length) truncated = true;
    seasons.push({ season: seasons.length + 1, episodes: slice });
    total += slice.length;
  }
  if (seasons.length === 0) throw upstreamError("not-found", undefined, false);

  const show = base || best;
  return {
    source: "jikan",
    externalId: show.mal_id,
    name: show.title_english || show.title || title,
    firstYear: show.year || undefined,
    totalEpisodes: total,
    seasons,
    posterUrl: show.images?.jpg?.large_image_url || undefined,
    backdropUrl: show.images?.jpg?.large_image_url || undefined,
    truncated: truncated || undefined,
  };
}

/* ── AniList (fallback) ──────────────────────────────────────────── */

interface AniListMedia {
  id: number;
  title?: { romaji?: string | null; english?: string | null };
  episodes?: number | null;
  format?: string | null;
  coverImage?: { large?: string | null } | null;
  bannerImage?: string | null;
}

async function anilistQuery<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchTimeout(
      ANILIST_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      },
      15000,
    );
  } catch {
    throw upstreamError("anilist network", undefined, true);
  }
  if (!res.ok) throw upstreamError(`anilist ${res.status}`, res.status, res.status >= 500);
  const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (json.errors?.length) {
    throw upstreamError(json.errors[0].message || "anilist error", 502, true);
  }
  return json.data as T;
}

async function fetchViaAniList(title: string): Promise<AnimeShowInfo> {
  const search = await anilistQuery<{ Page?: { media?: AniListMedia[] } }>(
    `query($q: String) {
      Page(page: 1, perPage: 15) {
        media(search: $q, type: ANIME, sort: POPULARITY_DESC) {
          id
          title { romaji english }
          episodes
          format
          coverImage { large }
          bannerImage
        }
      }
    }`,
    { q: title },
  );
  const items = (search?.Page?.media || []).filter(
    (m) => m.id && ["TV", "ONA", "OVA"].includes(m.format || ""),
  );
  const suggestions = (search?.Page?.media || [])
    .slice(0, 4)
    .map((m) => m.title?.english || m.title?.romaji)
    .filter(Boolean) as string[];
  if (items.length === 0) throw Object.assign(upstreamError("not-found"), { suggestions });
  const scored = items
    .map((m) => ({ m, s: scoreTitle(title, { title: m.title?.romaji || m.title?.english }) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const best = scored[0]?.m || items[0];

  // season: true → TMDb-style season list (this anime + every linked season).
  const seasonsData = await anilistQuery<{ Media?: AniListMedia[] }>(
    `query($id: Int) {
      Media(id: $id, type: ANIME, season: true) {
        id
        title { romaji english }
        episodes
        coverImage { large }
        bannerImage
      }
    }`,
    { id: best.id },
  );
  const list = seasonsData?.Media || [];

  const seasons: AnimeSeason[] = [];
  let total = 0;
  let truncated = false;
  for (const s of list) {
    const count = Math.max(0, Math.floor(Number(s.episodes) || 0));
    if (count === 0) continue;
    const slice = Math.min(count, MAX_EPISODES - total);
    if (slice <= 0) {
      truncated = true;
      break;
    }
    if (slice < count) truncated = true;
    seasons.push({
      season: seasons.length + 1,
      episodes: Array.from({ length: slice }, (_, i) => ({ episode: i + 1 })),
    });
    total += slice;
  }
  if (seasons.length === 0) throw upstreamError("not-found", undefined, false);

  return {
    source: "anilist",
    externalId: best.id,
    name: best.title?.english || best.title?.romaji || title,
    totalEpisodes: total,
    seasons,
    posterUrl: best.coverImage?.large || undefined,
    backdropUrl: best.bannerImage || best.coverImage?.large || undefined,
    truncated: truncated || undefined,
  };
}

/* ── Route ───────────────────────────────────────────────────────── */

const cache = new Map<
  string,
  {
    ts: number;
    ok: boolean;
    data?: AnimeShowInfo;
    error?: { code: string; message: string; status: number; suggestions?: string[] };
  }
>();

export const Route = createFileRoute("/api/anime-series")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") || url.searchParams.get("title") || "").trim();
        if (q.length < 3) {
          return Response.json(
            { ok: false, error: "bad-input", message: "Anime ka naam daalo (minimum 3 letters)." },
            { status: 400 },
          );
        }
        const cacheKey = q.toLowerCase();
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < (cached.ok ? OK_CACHE_TTL_MS : FAIL_CACHE_TTL_MS)) {
          if (cached.ok && cached.data) {
            return Response.json(
              { ok: true, ...cached.data },
              {
                headers: { "cache-control": "public, max-age=3600" },
              },
            );
          }
          const e = cached.error!;
          return Response.json(
            { ok: false, error: e.code, message: e.message, suggestions: e.suggestions },
            { status: e.status },
          );
        }

        // Jikan first (has per-episode stills); AniList when Jikan is down/limited.
        let info: AnimeShowInfo | null = null;
        let lastError: UpstreamError | null = null;
        try {
          info = await fetchViaJikan(q);
        } catch (err) {
          lastError = err as UpstreamError;
          if (lastError.fallbackable) {
            try {
              info = await fetchViaAniList(q);
              lastError = null;
            } catch (err2) {
              lastError = err2 as UpstreamError;
            }
          }
        }

        if (info) {
          cache.set(cacheKey, { ts: Date.now(), ok: true, data: info });
          return Response.json(
            { ok: true, ...info },
            {
              headers: { "cache-control": "public, max-age=3600" },
            },
          );
        }

        const message = lastError?.message || "unknown error";
        if (message === "not-found") {
          const body = {
            ok: false,
            error: "not-found" as const,
            message:
              "MAL/AniList me yeh anime nahi mila — naam English me exact try karo (jaise 'Jujutsu Kaisen', 'Solo Leveling'). Ya manual Seasons/Episodes se generate karo.",
            suggestions: lastError?.suggestions,
          };
          cache.set(cacheKey, {
            ts: Date.now(),
            ok: false,
            error: { ...body, status: 404, code: "not-found" },
          });
          return Response.json(body, { status: 404 });
        }
        console.error("[anime-series] fetch failed:", message);
        const errBody = {
          ok: false,
          error: "upstream" as const,
          message: "Anime data fetch nahi hua (MAL/AniList). Thodi der me dobara try karo.",
        };
        cache.set(cacheKey, {
          ts: Date.now(),
          ok: false,
          error: { ...errBody, status: 502, code: "upstream" },
        });
        return Response.json(errBody, { status: 502 });
      },
    },
  },
});
