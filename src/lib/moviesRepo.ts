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

export async function fetchAllMovies(): Promise<{
  uploaded: Movie[];
  synced: Movie[];
}> {
  const { data, error } = await supabase
    .from("movies")
    .select(
      "id,title,description,image,backdrop,thumbnail_url,year,rating,duration,genre,match_score,cast_members,creator,video_url,youtube_id,embed_url,embed_platform,playlist_id,playlist_title,episode_number,season_number,is_collection,source_type,created_at"
    )
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[moviesRepo] fetch error", error);
    return { uploaded: [], synced: [] };
  }
  const uploaded: Movie[] = [];
  const synced: Movie[] = [];
  (data ?? []).forEach((r: any) => {
    const m = rowToMovie(r);
    if (r.source_type === "synced") synced.push(m);
    else uploaded.push(m); // 'uploaded' + 'demo' both shown as library items
  });
  return { uploaded, synced };
}

export async function fetchMovieImages(): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from("movies")
    .select("id,image,thumbnail_url,backdrop");
  if (error) return new Map();
  return new Map(
    (data ?? []).map((row: any) => [
      Number(row.id),
      row.thumbnail_url || row.image || row.backdrop || "",
    ])
  );
}

export async function insertMovies(
  movies: Movie[],
  sourceType: "uploaded" | "synced"
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

export async function updateMovieThumbnail(
  id: number,
  imageUrl: string
): Promise<boolean> {
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
  const { error } = await supabase
    .from("movies")
    .delete()
    .eq("playlist_id", playlistId);
  if (error) {
    console.error("[moviesRepo] delete playlist error", error);
    return false;
  }
  return true;
}
