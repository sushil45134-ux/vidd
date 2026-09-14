import { createFileRoute } from "@tanstack/react-router";
import {
  ANIME_CHANNELS,
  ANIME_SEED,
  dedupeEpisodes,
  isHindiDubTitle,
  parseYouTubeFeed,
  playlistFeedUrl,
  type AnimeChannel,
  type AnimeEpisode,
} from "../../lib/animeCatalog";

/**
 * Server-side proxy for the official Muse India / Muse Hindi Dub YouTube feeds.
 *
 * Two-stage fetch so every series shows its FULL season, not just the newest
 * few episodes:
 *   1. Read each channel's public Atom feed — this surfaces the recently
 *      published Hindi-dubbed episodes AND the "Hindi Dub" playlist id that
 *      every episode links to in its description.
 *   2. Read each discovered playlist's own Atom feed — YouTube returns the
 *      whole playlist there (episode 001 → latest), giving us the complete
 *      season without any API key.
 *
 * Results are merged, de-duplicated and cached for a few minutes. If the live
 * feeds are unreachable we fall back to a small bundled snapshot so the UI
 * never shows a blank shelf.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { ts: number; episodes: AnimeEpisode[] } | null = null;

/** One in-flight background refresh (also used for the cold-start race). */
let refreshing: Promise<AnimeEpisode[]> | null = null;

function dedupeOrSeed(live: AnimeEpisode[]): AnimeEpisode[] {
  const merged = dedupeEpisodes(live);
  return merged.length > 0 ? merged : dedupeEpisodes(ANIME_SEED);
}

function startRefresh(): Promise<AnimeEpisode[]> {
  if (!refreshing) {
    refreshing = fetchLiveCatalog()
      .then((live) => {
        const episodes = dedupeOrSeed(live);
        cache = { ts: Date.now(), episodes };
        return episodes;
      })
      .catch(() => {
        // Unreachable feeds — keep serving whatever we have (or the seed)
        // and rate-limit retries with a fresh timestamp.
        const episodes = cache ? cache.episodes : dedupeEpisodes(ANIME_SEED);
        cache = { ts: Date.now(), episodes };
        return episodes;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

function serve(episodes: AnimeEpisode[], source: string, maxAge: number): Response {
  return Response.json(
    { source, total: episodes.length, episodes: episodes.slice(0, 500) },
    { headers: { "cache-control": `public, max-age=${maxAge}` } },
  );
}

async function fetchFeed(url: string, channel: AnimeChannel): Promise<AnimeEpisode[]> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "vid-anime/1.0 (+https://github.com)" },
    });
    if (!res.ok) return [];
    return parseYouTubeFeed(await res.text(), channel);
  } catch {
    return [];
  }
}

async function fetchLiveCatalog(): Promise<AnimeEpisode[]> {
  // Stage 1 — channel feeds (recent episodes + playlist discovery).
  const channelResults = await Promise.allSettled(
    ANIME_CHANNELS.map((channel) => fetchFeed(channel.feedUrl, channel)),
  );
  const channelEpisodes: AnimeEpisode[] = [];
  for (const r of channelResults) {
    if (r.status === "fulfilled") channelEpisodes.push(...r.value);
  }

  const hindi = channelEpisodes.filter((e) => isHindiDubTitle(e.title));

  // Discover every "Hindi Dub" playlist referenced by these episodes.
  const playlistChannel = new Map<string, AnimeChannel>();
  for (const ep of hindi) {
    if (!ep.playlistId || playlistChannel.has(ep.playlistId)) continue;
    const channel = ANIME_CHANNELS.find((c) => c.name === ep.channelName) ?? ANIME_CHANNELS[0];
    playlistChannel.set(ep.playlistId, channel);
  }

  // Stage 2 — each playlist's full feed (complete seasons).
  const playlistResults = await Promise.allSettled(
    [...playlistChannel.entries()].map(([playlistId, channel]) =>
      fetchFeed(playlistFeedUrl(playlistId), channel),
    ),
  );
  const playlistEpisodes: AnimeEpisode[] = [];
  for (const r of playlistResults) {
    if (r.status === "fulfilled") playlistEpisodes.push(...r.value);
  }

  return [...playlistEpisodes, ...hindi];
}

export const Route = createFileRoute("/api/anime")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const limitParam = Number(url.searchParams.get("limit") ?? "500");
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 500;

        try {
          if (cache && Date.now() - cache.ts <= CACHE_TTL_MS) {
            return serve(cache.episodes, "live", 600);
          }

          if (cache) {
            // Stale-while-revalidate: the shelf renders from the previous
            // catalog RIGHT AWAY while the feeds refresh out of band. A
            // serverless cold start that awaits a dozen YouTube Atom feeds
            // used to leave the Anime tab hanging for many seconds.
            void startRefresh();
            return serve(cache.episodes, "stale", 300);
          }

          // Cold cache: bounded live fetch — the request itself becomes the
          // shared refresh, so parallel visitors don't multiply feed hits.
          const winner = await Promise.race([
            startRefresh().then(
              (episodes) => episodes,
              () => null,
            ),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
          if (winner && winner.length > 0) return serve(winner, "live", 600);
          if (winner) return serve(winner, "seed", 120);
          // Timed out — serve the bundled snapshot now; the background
          // refresh keeps going and later requests get the real catalog.
          return serve(dedupeEpisodes(ANIME_SEED), "seed", 120);
        } catch {
          const seed = dedupeEpisodes(ANIME_SEED);
          return Response.json(
            { source: "seed", total: seed.length, episodes: seed.slice(0, limit) },
            { headers: { "cache-control": "public, max-age=300" } },
          );
        }
      },
    },
  },
});
