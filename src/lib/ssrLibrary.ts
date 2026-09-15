/**
 * Minimal movie shape rendered into the SSR HTML so that browsers which can
 * never run the client bundle (pre-module TV browsers like Tizen 2.4/3.0,
 * old LG webOS WebKit, or any engine where the ES-module graph dies) still
 * see a full poster library instead of a forever-"Loading…" shell.
 */
export interface SsrMovie {
  id: number;
  title: string;
  image: string;
  backdrop: string;
  genre: string[];
  year: number | null;
  rating: string | null;
  /** Direct watch link (YouTube / embed) for no-JS browsers. */
  watchUrl: string;
}

import { SSR_LIBRARY_SNAPSHOT } from "./ssrSnapshot";

/**
 * Returns the static library snapshot for the SSR document.
 *
 * Deliberately does NOT query the DB at request time: SSR latency must not
 * depend on a third-party database, and interactive clients always fetch
 * live data on boot (the snapshot only ever paints for browsers that cannot
 * hydrate, plus crawlers). Refresh the snapshot with
 * `node scripts/refresh-ssr-snapshot.mjs` after big library changes.
 */
export async function loadSsrLibrary(): Promise<SsrMovie[] | null> {
  if (typeof window !== "undefined") return null;
  return SSR_LIBRARY_SNAPSHOT;
}
