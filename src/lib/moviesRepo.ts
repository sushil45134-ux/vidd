import { supabase } from "@/integrations/supabase/client";
import type { Movie } from "@/data";
import { isMissingAudioColumnError, normalizeAudioSources } from "./audioSources";
import { isTvBrowser } from "./browser";

/** True when Postgres/Supabase complains about the optional audio column. */
const isMissingAudioColumn = isMissingAudioColumnError;

/**
 * The multi-audio column ships in supabase-schema.sql, but the app must keep
 * working on a database where it has not been added yet. Once a request tells
 * us the column is missing we stop asking for it for the rest of the session.
 */
let audioColumnAvailable: boolean | null = null;

function columnsWithAudio(base: string): string {
  return audioColumnAvailable === false ? base : `${base},audio_sources`;
}

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

// DB row -> Movie
export function rowToMovie(r: any): Movie {
  const replaceNxsha = isFranchiseNxshaMovie(r);
  const fallbackImage = r.youtube_id
    ? `https://img.youtube.com/vi/${r.youtube_id}/hqdefault.jpg`
    : r.embed_platform === "Dailymotion" && r.embed_url
      ? `https://www.dailymotion.com/thumbnail/video/${String(r.embed_url).split("/video/")[1]?.split("?")[0] || ""}`
      : "https://placehold.co/640x360/181818/777?text=Video";
  return {
    id: Number(r.id),
    title: r.title,
    description: r.description ?? "",
    image: r.image || r.thumbnail_url || fallbackImage,
    backdrop: r.backdrop || r.image || r.thumbnail_url || fallbackImage,
    year: r.year,
    rating: r.rating,
    duration: r.duration ?? "",
    genre: r.genre ?? [],
    match: r.match_score ?? 95,
    cast: r.cast_members ?? undefined,
    creator: r.creator ?? undefined,
    videoUrl: replaceNxsha ? toonstreamVideoUrl(r) : (r.video_url ?? undefined),
    thumbnailUrl: r.thumbnail_url ?? undefined,
    youtubeId: r.youtube_id ?? undefined,
    embedUrl: replaceNxsha ? undefined : (r.embed_url ?? undefined),
    embedPlatform: replaceNxsha ? "ToonStream" : (r.embed_platform ?? undefined),
    audioSources: normalizeAudioSources(r.audio_sources),
    createdAt: r.created_at ?? undefined,
    playlistId: r.playlist_id ?? undefined,
    playlistTitle: r.playlist_title ?? undefined,
    episodeNumber: r.episode_number ?? undefined,
    seasonNumber: r.season_number ?? undefined,
    isCollection: r.is_collection ?? false,
  };
}

export function movieToRow(m: Movie, sourceType: "uploaded" | "synced" | "demo") {
  return {
    title: m.title,
    description: m.description ?? "",
    image: m.image,
    backdrop: m.backdrop ?? null,
    year: m.year,
    rating: m.rating,
    duration: m.duration ?? "",
    genre: m.genre ?? [],
    match_score: m.match ?? 95,
    cast_members: m.cast ?? null,
    creator: m.creator ?? null,
    video_url: m.videoUrl ?? null,
    thumbnail_url: m.thumbnailUrl ?? null,
    youtube_id: m.youtubeId ?? null,
    embed_url: m.embedUrl ?? null,
    embed_platform: m.embedPlatform ?? null,
    // Always an array: the column is `not null default '[]'`, so sending null
    // would make a movie without extra languages fail to save at all.
    audio_sources: m.audioSources && m.audioSources.length > 0 ? m.audioSources : [],
    playlist_id: m.playlistId ?? null,
    playlist_title: m.playlistTitle ?? null,
    episode_number: m.episodeNumber ?? null,
    season_number: m.seasonNumber ?? null,
    is_collection: m.isCollection ?? false,
    source_type: sourceType,
  };
}

const MOVIES_PAGE_SIZE = 1000;
const MOVIES_COLUMNS =
  "id,title,description,image,backdrop,thumbnail_url,year,rating,duration,genre,match_score,cast_members,creator,video_url,youtube_id,embed_url,embed_platform,playlist_id,playlist_title,episode_number,season_number,is_collection,source_type,created_at";
const MOVIES_COLUMNS_LIGHT = MOVIES_COLUMNS.replace("description,", "").replace(
  "cast_members,",
  "",
);

interface MoviesPageResult {
  data: Array<Record<string, unknown>> | null;
  error: unknown;
  count: number | null;
}

async function fetchMoviesPage(
  client: typeof supabase,
  from: number,
  exactCount: boolean,
  columns: string = MOVIES_COLUMNS,
): Promise<MoviesPageResult> {
  try {
    const { data, error, count } = await client
      .from("movies")
      .select(columnsWithAudio(columns), exactCount ? { count: "exact" } : undefined)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + MOVIES_PAGE_SIZE - 1);
    if (error && isMissingAudioColumn(error)) {
      audioColumnAvailable = false;
      return fetchMoviesPage(client, from, exactCount, columns);
    }
    return { data: (data as any) ?? null, error, count: count ?? null };
  } catch (e) {
    return { data: null, error: e, count: null };
  }
}

async function fetchMoviesPageViaProxy(
  from: number,
  exactCount: boolean,
  columns: string = MOVIES_COLUMNS,
): Promise<MoviesPageResult> {
  try {
    if (typeof window === "undefined") return { data: null, error: "SSR skip", count: null };
    const params = new URLSearchParams({
      from: String(from),
      limit: String(MOVIES_PAGE_SIZE),
      columns: columnsWithAudio(columns),
    });
    if (exactCount) params.set("count", "1");
    const res = await fetch(`/api/movies?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { data: null, error: `proxy ${res.status}`, count: null };
    const json = (await res.json()) as {
      data?: any[];
      count?: number | null;
      error?: string;
      details?: string;
    };
    if (json.error) {
      // The proxy reports the Supabase message in `details`, so check both.
      if (isMissingAudioColumn(json)) {
        audioColumnAvailable = false;
        return fetchMoviesPageViaProxy(from, exactCount, columns);
      }
      return { data: null, error: json.error, count: null };
    }
    return { data: json.data ?? null, error: null, count: json.count ?? null };
  } catch (e) {
    return { data: null, error: e, count: null };
  }
}

// Keep the test row opt-in in production, but make branch Previews usable even
// when the Vercel Preview environment variable cannot be configured.
const IS_VERCEL_PREVIEW =
  typeof window !== "undefined" && /-git-[^.]+-/i.test(window.location.hostname);
const NETMIRROR_DEMO = (import.meta as any).env?.VITE_NETMIRROR_DEMO === "1" || IS_VERCEL_PREVIEW;
const NETMIRROR_DEMO_MOVIES: Movie[] = [
  {
    id: 915085900,
    title: "Chhota Bheem and the Curse of Damyaan",
    description: "Test — direct MP4 via /api/stream",
    image: "https://image.tmdb.org/t/p/w780/vt6ZkHyrrfLlTdiomnoGlNcgcHy.jpg",
    backdrop: "https://image.tmdb.org/t/p/w1280/vt6ZkHyrrfLlTdiomnoGlNcgcHy.jpg",
    year: 2012,
    rating: "U",
    duration: "1h 6m",
    genre: ["Cartoon"],
    match: 97,
    videoUrl: "/api/stream?tmdb=150859",
  },
  {
    id: 915085901,
    title: "Doraemon the Movie: Nobita's Little Star Wars 2021",
    description: "Test — ToonStream extract",
    image: "https://image.tmdb.org/t/p/w780/u5sFU0Uw3qtFOeWNvnhLAt9JzbA.jpg",
    backdrop: "https://image.tmdb.org/t/p/w1280/iflKt34Ck2JpY2PY9wW1zwdJgJi.jpg",
    year: 2022,
    rating: "U",
    duration: "1h 49m",
    genre: ["Cartoon"],
    match: 96,
    videoUrl: `/api/extract?url=${encodeURIComponent("https://vidmoly.me/embed-w2buir2swpkr.html")}`,
  },
];

function splitRows(rows: Array<Record<string, unknown>>, failed = false) {
  const uploaded: Movie[] = [];
  const synced: Movie[] = [];
  rows.forEach((r: any) => {
    const m = rowToMovie(r);
    if (r.source_type === "synced") synced.push(m);
    else uploaded.push(m);
  });
  if (NETMIRROR_DEMO)
    for (const demo of NETMIRROR_DEMO_MOVIES)
      if (!synced.some((m) => m.id === demo.id) && !uploaded.some((m) => m.id === demo.id))
        synced.push(demo);
  return { uploaded, synced, failed };
}

export async function fetchAllMovies(
  client: typeof supabase = supabase,
  onFirstPage?: (partial: { uploaded: Movie[]; synced: Movie[] }) => void,
): Promise<{ uploaded: Movie[]; synced: Movie[]; failed: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  const isBrowser = typeof window !== "undefined";
  const isTv = isBrowser && isTvBrowser();
  const isLocalHost =
    isBrowser &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
  const isHttp = isBrowser && window.location.protocol === "http:";
  const useProxyOnly = isTv || isLocalHost || isHttp;

  let first: MoviesPageResult | null = null;

  if (useProxyOnly) {
    first = await fetchMoviesPageViaProxy(0, true);
    // On TV/local, if proxy fails we do NOT fallback to direct (avoids CORS console errors)
    // Instead we return empty and let cache show, or mark failed
    if (first.error || !first.data) {
      // Try direct only if not in a known CORS-blocked environment? For TV we still try direct as last resort but suppress console
      // Actually for local dev we skip direct to avoid consoleErrors that break device-check
      if (!isLocalHost) {
        const direct = await fetchMoviesPage(client, 0, true);
        if (!direct.error && direct.data && direct.data.length > 0) first = direct;
      }
    }
  } else {
    // Desktop prod: try direct first (faster), fallback to proxy
    first = await fetchMoviesPage(client, 0, true);
    if (first.error || !first.data || first.data.length === 0) {
      const viaProxy = await fetchMoviesPageViaProxy(0, true);
      if (!viaProxy.error && viaProxy.data && viaProxy.data.length > 0) first = viaProxy;
    }
  }

  if (!first) first = { data: null, error: "no data", count: null };

  if (first.error || !first.data || first.data.length === 0) {
    return splitRows(rows, !!first.error);
  }
  rows.push(...first.data);
  if (onFirstPage) {
    try {
      onFirstPage(splitRows(rows));
    } catch {}
  }
  if (first.data.length < MOVIES_PAGE_SIZE) return splitRows(rows);
  const total = first.count;
  if (total == null || total <= rows.length) {
    let hadError = false;
    let from = rows.length;
    for (;;) {
      let page: MoviesPageResult;
      if (useProxyOnly) {
        page = await fetchMoviesPageViaProxy(from, false, MOVIES_COLUMNS_LIGHT);
        if ((page.error || !page.data) && !isLocalHost) {
          page = await fetchMoviesPage(client, from, false, MOVIES_COLUMNS_LIGHT);
        }
      } else {
        page = await fetchMoviesPage(client, from, false, MOVIES_COLUMNS_LIGHT);
        if (page.error || !page.data) {
          page = await fetchMoviesPageViaProxy(from, false, MOVIES_COLUMNS_LIGHT);
        }
      }
      if (page.error) {
        hadError = true;
        break;
      }
      if (!page.data || page.data.length === 0) break;
      rows.push(...page.data);
      if (page.data.length < MOVIES_PAGE_SIZE) break;
      from += MOVIES_PAGE_SIZE;
    }
    return splitRows(rows, hadError && rows.length === 0);
  }
  const starts: number[] = [];
  for (let from = rows.length; from < total; from += MOVIES_PAGE_SIZE) starts.push(from);

  const fetchFn = async (from: number): Promise<MoviesPageResult> => {
    if (useProxyOnly) {
      const viaProxy = await fetchMoviesPageViaProxy(from, false, MOVIES_COLUMNS_LIGHT);
      if (!viaProxy.error && viaProxy.data) return viaProxy;
      if (!isLocalHost) return fetchMoviesPage(client, from, false, MOVIES_COLUMNS_LIGHT);
      return viaProxy;
    }
    const direct = await fetchMoviesPage(client, from, false, MOVIES_COLUMNS_LIGHT);
    if (!direct.error && direct.data) return direct;
    return fetchMoviesPageViaProxy(from, false, MOVIES_COLUMNS_LIGHT);
  };

  const settled = await Promise.all(starts.map((from) => fetchFn(from)));
  for (const page of settled) {
    if (page.error || !page.data) break;
    rows.push(...page.data);
    if (page.data.length < MOVIES_PAGE_SIZE) break;
  }
  return splitRows(rows);
}

export async function fetchMovieImages(): Promise<Map<number, string>> {
  try {
    if (typeof window !== "undefined" && isTvBrowser()) {
      const res = await fetch(
        "/api/movies?from=0&limit=1000&columns=id,image,thumbnail_url,backdrop",
      );
      if (res.ok) {
        const json = (await res.json()) as { data?: any[] };
        if (json.data) {
          return new Map(
            (json.data ?? []).map((row: any) => [
              Number(row.id),
              row.thumbnail_url || row.image || row.backdrop || "",
            ]),
          );
        }
      }
    }
  } catch {}
  try {
    const { data, error } = await supabase.from("movies").select("id,image,thumbnail_url,backdrop");
    if (error) return new Map();
    return new Map(
      (data ?? []).map((row: any) => [
        Number(row.id),
        row.thumbnail_url || row.image || row.backdrop || "",
      ]),
    );
  } catch {
    return new Map();
  }
}

export async function fetchMovieById(id: number): Promise<Movie | null> {
  try {
    const { data, error } = await supabase
      .from("movies")
      .select(MOVIES_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return rowToMovie(data);
  } catch {
    return null;
  }
}

export async function insertMovies(
  movies: Movie[],
  sourceType: "uploaded" | "synced",
): Promise<Movie[]> {
  if (movies.length === 0) return [];
  const rows = movies.map((m) => movieToRow(m, sourceType));
  try {
    const { data, error } = await supabase.from("movies").insert(rows).select("*");
    if (error) {
      // Older database without `audio_sources`: keep the row, drop that field.
      if (isMissingAudioColumn(error)) {
        audioColumnAvailable = false;
        const stripped = rows.map(({ audio_sources: _drop, ...rest }) => rest);
        const retry = await supabase.from("movies").insert(stripped).select("*");
        if (retry.error) return [];
        return (retry.data ?? []).map(rowToMovie);
      }
      return [];
    }
    return (data ?? []).map(rowToMovie);
  } catch {
    return [];
  }
}

export async function updateMovieThumbnail(id: number, imageUrl: string): Promise<boolean> {
  if (imageUrl.startsWith("blob:")) return true;
  try {
    const { error } = await supabase
      .from("movies")
      .update({ image: imageUrl, thumbnail_url: imageUrl, backdrop: imageUrl })
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteMovieById(id: number): Promise<boolean> {
  try {
    const { error } = await supabase.from("movies").delete().eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteMoviesByPlaylist(playlistId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("movies").delete().eq("playlist_id", playlistId);
    return !error;
  } catch {
    return false;
  }
}
