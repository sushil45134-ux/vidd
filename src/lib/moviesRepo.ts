import { supabase } from "@/integrations/supabase/client";
import type { Movie } from "@/data";

// DB row -> Movie
export function rowToMovie(r: any): Movie {
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
    videoUrl: r.video_url ?? undefined,
    thumbnailUrl: r.thumbnail_url ?? undefined,
    youtubeId: r.youtube_id ?? undefined,
    embedUrl: r.embed_url ?? undefined,
    embedPlatform: r.embed_platform ?? undefined,
    playlistId: r.playlist_id ?? undefined,
    playlistTitle: r.playlist_title ?? undefined,
    episodeNumber: r.episode_number ?? undefined,
    seasonNumber: r.season_number ?? undefined,
    isCollection: r.is_collection ?? false,
  };
}

// Movie -> DB insert payload (id omitted so DB assigns it)
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
    playlist_id: m.playlistId ?? null,
    playlist_title: m.playlistTitle ?? null,
    episode_number: m.episodeNumber ?? null,
    season_number: m.seasonNumber ?? null,
    is_collection: m.isCollection ?? false,
    source_type: sourceType,
  };
}

// Supabase caps a single response at 1,000 rows. The library outgrew that, so
// one plain select() silently dropped every video older than the newest 1,000
// — and every row referencing those videos vanished from the site with them.
const MOVIES_PAGE_SIZE = 1000;

const MOVIES_COLUMNS =
  "id,title,description,image,backdrop,thumbnail_url,year,rating,duration,genre,match_score,cast_members,creator,video_url,youtube_id,embed_url,embed_platform,playlist_id,playlist_title,episode_number,season_number,is_collection,source_type,created_at";

interface MoviesPageResult {
  data: Array<Record<string, unknown>> | null;
  error: unknown;
  count: number | null;
}

async function fetchMoviesPage(
  client: typeof supabase,
  from: number,
  exactCount: boolean,
): Promise<MoviesPageResult> {
  const { data, error, count } = await client
    .from("movies")
    .select(MOVIES_COLUMNS, exactCount ? { count: "exact" } : undefined)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + MOVIES_PAGE_SIZE - 1);
  return { data, error, count: count ?? null };
}

function splitRows(rows: Array<Record<string, unknown>>): {
  uploaded: Movie[];
  synced: Movie[];
} {
  const uploaded: Movie[] = [];
  const synced: Movie[] = [];
  rows.forEach((r: any) => {
    const m = rowToMovie(r);
    if (r.source_type === "synced") synced.push(m);
    else uploaded.push(m); // 'uploaded' + 'demo' both shown as library items
  });
  return { uploaded, synced };
}

export async function fetchAllMovies(
  client: typeof supabase = supabase,
  /**
   * Called once with the first page (the newest 1,000 rows) so callers can
   * paint the hero and top rows immediately while the remaining pages are
   * still on the wire. Slow phone/TV networks otherwise stare at a skeleton
   * until every page of a 4,000+ row library has arrived.
   */
  onFirstPage?: (partial: { uploaded: Movie[]; synced: Movie[] }) => void,
): Promise<{ uploaded: Movie[]; synced: Movie[] }> {
  // Newest first; created_at ties (bulk inserts share one timestamp) need the
  // id tiebreak, otherwise a page boundary in a tied group could skip rows.
  // The first page also fetches the exact total so remaining pages load
  // concurrently instead of one round trip at a time.
  const rows: Array<Record<string, unknown>> = [];
  const first = await fetchMoviesPage(client, 0, true);
  if (first.error || !first.data || first.data.length === 0) {
    if (first.error) console.error("[moviesRepo] fetch error", first.error);
    return splitRows(rows);
  }
  rows.push(...first.data);
  if (onFirstPage) {
    try {
      onFirstPage(splitRows(rows));
    } catch {
      /* a partial-paint failure must never break the full fetch */
    }
  }
  if (first.data.length < MOVIES_PAGE_SIZE) return splitRows(rows);
  const total = first.count;
  if (total == null || total <= rows.length) {
    // No count available — fall back to sequential paging.
    let from = rows.length;
    for (;;) {
      const { data, error } = await fetchMoviesPage(client, from, false);
      if (error) {
        console.error("[moviesRepo] fetch error", error);
        break;
      }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < MOVIES_PAGE_SIZE) break;
      from += MOVIES_PAGE_SIZE;
    }
    return splitRows(rows);
  }
  const starts: number[] = [];
  for (let from = rows.length; from < total; from += MOVIES_PAGE_SIZE) starts.push(from);
  const settled = await Promise.all(
    starts.map((from) =>
      fetchMoviesPage(client, from, false).then(
        (r) => r,
        (e): MoviesPageResult => ({ data: null, error: e, count: null }),
      ),
    ),
  );
  // Keep only leading-contiguous successes — same no-gap guarantee as before.
  for (const page of settled) {
    if (page.error || !page.data) {
      if (page.error) console.error("[moviesRepo] fetch error", page.error);
      break;
    }
    rows.push(...page.data);
    if (page.data.length < MOVIES_PAGE_SIZE) break;
  }
  return splitRows(rows);
}

export async function fetchMovieImages(): Promise<Map<number, string>> {
  const { data, error } = await supabase.from("movies").select("id,image,thumbnail_url,backdrop");
  if (error) return new Map();
  return new Map(
    (data ?? []).map((row: any) => [
      Number(row.id),
      row.thumbnail_url || row.image || row.backdrop || "",
    ]),
  );
}

export async function insertMovies(
  movies: Movie[],
  sourceType: "uploaded" | "synced",
): Promise<Movie[]> {
  if (movies.length === 0) return [];
  const rows = movies.map((m) => movieToRow(m, sourceType));
  const { data, error } = await supabase.from("movies").insert(rows).select("*");
  if (error) {
    console.error("[moviesRepo] insert error", error);
    return [];
  }
  return (data ?? []).map(rowToMovie);
}

export async function updateMovieThumbnail(id: number, imageUrl: string): Promise<boolean> {
  // Skip persistence for blob: URLs (browser-local only)
  if (imageUrl.startsWith("blob:")) return true;
  const { error } = await supabase
    .from("movies")
    .update({ image: imageUrl, thumbnail_url: imageUrl, backdrop: imageUrl })
    .eq("id", id);
  if (error) {
    console.error("[moviesRepo] update thumbnail error", error);
    return false;
  }
  return true;
}

export async function deleteMovieById(id: number): Promise<boolean> {
  const { error } = await supabase.from("movies").delete().eq("id", id);
  if (error) {
    console.error("[moviesRepo] delete error", error);
    return false;
  }
  return true;
}

export async function deleteMoviesByPlaylist(playlistId: string): Promise<boolean> {
  const { error } = await supabase.from("movies").delete().eq("playlist_id", playlistId);
  if (error) {
    console.error("[moviesRepo] delete playlist error", error);
    return false;
  }
  return true;
}
