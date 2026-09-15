import type { Movie } from "../data";
import { safeLocalStorage } from "./safe-storage";

/**
 * Instant-paint cache for the movie library.
 *
 * The library outgrew 4,000 rows; caching the whole thing meant a ~5MB
 * JSON.parse on every boot and a ~5MB stringify per refresh — on phones and
 * TV hardware that alone froze the page for seconds (the "site lags /
 * won't open" report). The cache is therefore capped to the newest items:
 * it exists to paint the first rows instantly, never to hold the library.
 * The full list always arrives from the network fetch.
 */
const CACHE_KEY = "vid:moviesCache:v3";
const LEGACY_KEYS = ["vid:moviesCache:v2", "vid:moviesCache"];
/** Newest-first lists are sliced to this many rows per source. */
const MAX_CACHED_PER_SOURCE = 400;

interface LibraryCache {
  uploaded: Movie[];
  synced: Movie[];
}

function trimForCache(movies: Movie[]): Movie[] {
  return movies.length > MAX_CACHED_PER_SOURCE ? movies.slice(0, MAX_CACHED_PER_SOURCE) : movies;
}

/** Drop legacy (multi-megabyte) cache blobs so old devices stop paying for them. */
export function purgeLegacyMovieCaches(): void {
  try {
    for (const key of LEGACY_KEYS) safeLocalStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to purge */
  }
}

export function readMoviesCache(): LibraryCache | null {
  try {
    const raw = safeLocalStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LibraryCache>;
    if (Array.isArray(parsed.uploaded) && Array.isArray(parsed.synced)) {
      return { uploaded: parsed.uploaded, synced: parsed.synced };
    }
  } catch {
    /* corrupt or unwritten cache — fall through to null */
  }
  return null;
}

/**
 * Write the trimmed cache. Returns false when storage rejects the write
 * (quota/private mode) — callers treat that as best-effort only.
 */
export function writeMoviesCache(uploaded: Movie[], synced: Movie[]): boolean {
  try {
    safeLocalStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        uploaded: trimForCache(uploaded),
        synced: trimForCache(synced),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
