/**
 * Anime Episode Sync — client helpers.
 *
 * /api/anime-sync compares your Supabase collections with AniList/Jikan and
 * returns ready-to-insert rows for every NEW aired episode (and even brand
 * new seasons). This lib fetches that plan and inserts the rows through the
 * logged-in admin's Supabase session (RLS allows authenticated writes only).
 */

import type { Movie } from "../data";
import { insertMovies } from "./moviesRepo";

export interface SyncRow {
  title: string;
  description: string;
  image: string;
  backdrop?: string;
  thumbnailUrl?: string;
  year: number;
  rating: string;
  duration: string;
  genre: string[];
  match: number;
  cast?: string[];
  creator?: string;
  embedUrl: string;
  embedPlatform?: string;
  playlistId: string;
  playlistTitle: string;
  episodeNumber: number;
  seasonNumber: number;
}

export interface SyncSeasonInfo {
  seasonNumber: number;
  seasonTitle: string;
  anilistId?: number;
  malId?: number;
  anilistStatus?: string;
  dbEpisodes: number;
  airedEpisodes: number;
  totalExpected?: number;
  isNewSeason: boolean;
  reason?: string;
  newEpisodes: SyncRow[];
}

export interface SyncCollectionInfo {
  playlistId: string;
  playlistTitle: string;
  imdbId?: string;
  provider?: string;
  status: "ok" | "skipped";
  reason?: string;
  seasons: SyncSeasonInfo[];
}

export interface SyncPlan {
  ok: boolean;
  checkedAt: string;
  collections: SyncCollectionInfo[];
  totalNewEpisodes: number;
  movies: SyncRow[];
  note?: string;
  error?: string;
}

export async function fetchEpisodeSyncPlan(playlistId?: string): Promise<SyncPlan> {
  const params = new URLSearchParams();
  if (playlistId) params.set("playlistId", playlistId);
  const qs = params.toString();
  const res = await fetch(`/api/anime-sync${qs ? `?${qs}` : ""}`);
  const data = (await res.json().catch(() => ({}))) as SyncPlan;
  if (!res.ok) throw new Error(data.error || `Sync failed: ${res.status}`);
  return data;
}

/** All (playlistId, season, episode) keys currently in the DB — for dedupe. */
async function fetchExistingEpisodeKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let from = 0;
  for (;;) {
    const res = await fetch(
      `/api/movies?from=${from}&limit=1000&columns=playlist_id,season_number,episode_number`,
    );
    if (!res.ok) break;
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<Record<string, unknown>>;
    };
    const rows = json.data || [];
    for (const r of rows) {
      if (r.playlist_id && r.season_number != null && r.episode_number != null) {
        keys.add(`${r.playlist_id}|${r.season_number}|${r.episode_number}`);
      }
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return keys;
}

export interface ApplyResult {
  added: Movie[];
  skippedDuplicates: number;
}

/**
 * Filter a plan down to rows that don't already exist in Supabase, so a
 * double-click (or two admins syncing together) can never create duplicates.
 */
export async function dedupeSyncRows(
  rows: SyncRow[],
): Promise<{ fresh: SyncRow[]; skipped: number }> {
  if (rows.length === 0) return { fresh: [], skipped: 0 };
  let existing: Set<string>;
  try {
    existing = await fetchExistingEpisodeKeys();
  } catch {
    existing = new Set();
  }
  const fresh = rows.filter(
    (r) => !existing.has(`${r.playlistId}|${r.seasonNumber}|${r.episodeNumber}`),
  );
  return { fresh, skipped: rows.length - fresh.length };
}

/** Convert a sync row into the app's Movie shape (id is temporary). */
export function syncRowToMovie(r: SyncRow, i: number): Movie {
  return {
    id: Date.now() + i,
    title: r.title,
    description: r.description || "",
    image: r.image,
    backdrop: r.backdrop,
    thumbnailUrl: r.thumbnailUrl,
    year: r.year,
    rating: r.rating,
    duration: r.duration,
    genre: r.genre,
    match: r.match,
    cast: r.cast,
    creator: r.creator,
    embedUrl: r.embedUrl,
    embedPlatform: r.embedPlatform,
    playlistId: r.playlistId,
    playlistTitle: r.playlistTitle,
    episodeNumber: r.episodeNumber,
    seasonNumber: r.seasonNumber,
    isCollection: false,
  };
}

/**
 * Insert the plan's new episodes into Supabase directly (alternative to
 * piping them through handleUpload). Re-checks the DB right before
 * inserting to avoid duplicates.
 */
export async function applyEpisodeSyncPlan(plan: SyncPlan): Promise<ApplyResult> {
  const rows = plan.movies || [];
  if (rows.length === 0) return { added: [], skippedDuplicates: 0 };

  const { fresh, skipped } = await dedupeSyncRows(rows);
  const skippedDuplicates = skipped;
  if (fresh.length === 0) return { added: [], skippedDuplicates };

  const asMovies: Movie[] = fresh.map((r, i) => ({
    id: Date.now() + i, // temporary — Supabase assigns the real id
    title: r.title,
    description: r.description || "",
    image: r.image,
    backdrop: r.backdrop,
    thumbnailUrl: r.thumbnailUrl,
    year: r.year,
    rating: r.rating,
    duration: r.duration,
    genre: r.genre,
    match: r.match,
    cast: r.cast,
    creator: r.creator,
    embedUrl: r.embedUrl,
    embedPlatform: r.embedPlatform,
    playlistId: r.playlistId,
    playlistTitle: r.playlistTitle,
    episodeNumber: r.episodeNumber,
    seasonNumber: r.seasonNumber,
    isCollection: false,
  }));

  const inserted = await insertMovies(asMovies, "synced");
  return { added: inserted, skippedDuplicates };
}

/* ── localStorage helpers for the throttled background check ── */

const LAST_CHECK_KEY = "vid:animeSyncLastCheck";
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function shouldAutoSyncCheck(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
    return Date.now() - last > AUTO_CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}

export function markSyncCheckDone(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — auto-check just runs again next time */
  }
}
