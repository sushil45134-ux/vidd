import { createFileRoute } from "@tanstack/react-router";
import {
  ANIME_CHANNELS,
  ANIME_SEED,
  dedupeEpisodes,
  isHindiDubTitle,
  parseYouTubeFeed,
  type AnimeEpisode,
} from "../../lib/animeCatalog";

/**
 * Server-side proxy for the official Muse India / Muse Hindi Dub YouTube feeds.
 *
 * The browser can't fetch YouTube's Atom feeds directly (no CORS), so this
 * route fetches them server-side, keeps only Hindi-dubbed episodes, de-dupes,
 * and returns plain JSON for the client. Results are cached for a few minutes
 * to stay polite to YouTube. If the live feeds are unreachable we fall back to
 * a small bundled snapshot so the UI never shows a blank shelf.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { ts: number; episodes: AnimeEpisode[] } | null = null;

async function fetchLiveFeeds(): Promise<AnimeEpisode[]> {
  const results = await Promise.allSettled(
    ANIME_CHANNELS.map(async (channel) => {
      const res = await fetch(channel.feedUrl, {
        headers: { "user-agent": "vid-anime/1.0 (+https://github.com)" },
      });
      if (!res.ok) return [] as AnimeEpisode[];
      const xml = await res.text();
      return parseYouTubeFeed(xml, channel);
    }),
  );

  const all: AnimeEpisode[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  return all;
}

export const Route = createFileRoute("/api/anime")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const limitParam = Number(url.searchParams.get("limit") ?? "60");
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 60;

        try {
          if (!cache || Date.now() - cache.ts > CACHE_TTL_MS) {
            let episodes = await fetchLiveFeeds();
            const hindi = episodes.filter((e) => isHindiDubTitle(e.title));
            const merged = dedupeEpisodes(hindi);
            cache = {
              ts: Date.now(),
              episodes: merged.length > 0 ? merged : dedupeEpisodes(ANIME_SEED),
            };
          }

          const body = {
            source: cache.episodes.some((e) => !ANIME_SEED.some((s) => s.videoId === e.videoId))
              ? "live"
              : "seed",
            total: cache.episodes.length,
            episodes: cache.episodes.slice(0, limit),
          };

          return Response.json(body, {
            headers: { "cache-control": "public, max-age=600" },
          });
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
