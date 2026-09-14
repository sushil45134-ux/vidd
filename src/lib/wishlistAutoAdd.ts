import type { Movie } from "../data";
import { autoFetchToMovies, type AutoFetchResult } from "./animeAutoFetch";

export type TitleAddPhase = "queued" | "fetching" | "done" | "failed" | "skipped";

export interface TitleAddStatus {
  title: string;
  phase: TitleAddPhase;
  /** Resolved show name on success, error/skip reason otherwise. */
  detail?: string;
  imdbId?: string;
  episodes?: number;
}

export interface AutoAddOptions {
  providerId: string;
  onStatus: (status: TitleAddStatus) => void;
  signal?: AbortSignal;
  /** Pause between titles so upstream APIs are not hammered. Default 800ms. */
  delayMs?: number;
}

export interface AutoAddSummary {
  movies: Movie[];
  added: number;
  failed: number;
  skipped: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorName(e: unknown): string {
  if (e instanceof Error) return e.name;
  if (typeof e === "object" && e !== null && "name" in e)
    return String((e as { name: unknown }).name);
  return "";
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Fetch failed";
}

/**
 * Batch-add planned (wishlist) titles to the library.
 *
 * For each title the existing /api/anime-auto pipeline runs WITHOUT an
 * imdbId — the server auto-resolves the IMDb ID itself (known-IDs map,
 * then IMDb suggestions, then TVMaze), so no API key is needed anywhere.
 * Titles are processed one by one with a small pause; one failure never
 * stops the rest of the batch.
 */
export async function autoAddPlannedTitles(
  titles: string[],
  opts: AutoAddOptions,
): Promise<AutoAddSummary> {
  const { providerId, onStatus, signal, delayMs = 800 } = opts;
  const movies: Movie[] = [];
  const seenPlaylists = new Set<string>();
  let added = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    if (signal?.aborted) {
      skipped += 1;
      onStatus({ title, phase: "skipped", detail: "Rok diya gaya" });
      continue;
    }
    onStatus({ title, phase: "fetching" });
    try {
      const params = new URLSearchParams({ title });
      const res = await fetch(`/api/anime-auto?${params.toString()}`, { signal });
      const data = (await res.json().catch(() => null)) as
        | (AutoFetchResult & {
            error?: string;
          })
        | null;
      if (!res.ok) throw new Error(data?.error || `Server error ${res.status}`);
      if (!data || !Array.isArray(data.seasons) || data.seasons.length === 0) {
        throw new Error("Koi season/episode nahi mila");
      }
      const imdbId = data.imdbId || data.autoResolvedImdb || "";
      if (!imdbId) throw new Error("IMDb ID auto-resolve nahi hui");
      const batch = autoFetchToMovies(data, { imdbId, providerId });
      if (batch.length === 0) throw new Error("Episodes generate nahi hue");
      const playlistId = batch[0].playlistId;
      if (playlistId && seenPlaylists.has(playlistId)) {
        skipped += 1;
        onStatus({
          title,
          phase: "skipped",
          detail: `"${data.mainTitle}" is batch me pehle add ho chuka hai`,
          imdbId,
        });
      } else {
        if (playlistId) seenPlaylists.add(playlistId);
        movies.push(...batch);
        added += 1;
        onStatus({ title, phase: "done", detail: data.mainTitle, imdbId, episodes: batch.length });
      }
    } catch (e) {
      if (signal?.aborted || errorName(e) === "AbortError") {
        skipped += 1;
        onStatus({ title, phase: "skipped", detail: "Rok diya gaya" });
      } else {
        failed += 1;
        onStatus({ title, phase: "failed", detail: errorMessage(e) });
      }
    }
    if (i < titles.length - 1 && !signal?.aborted && delayMs > 0) await sleep(delayMs);
  }

  return { movies, added, failed, skipped };
}
