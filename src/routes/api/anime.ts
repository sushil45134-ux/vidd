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
    const channel =
      ANIME_CHANNELS.find((c) => c.name === ep.channelName) ?? ANIME_CHANNELS[0];
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
          if (!cache || Date.now() - cache.ts > CACHE_TTL_MS) {
            const live = await fetchLiveCatalog();
            const merged = dedupeEpisodes(live);
            cache = {
              ts: Date.now(),
              // Fall back to the snapshot only when nothing live came back.
              episodes: merged.length > 0 ? merged : dedupeEpisodes(ANIME_SEED),
            };
          }

          const body = {
            source: "live",
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
