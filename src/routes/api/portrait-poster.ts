import { createFileRoute } from "@tanstack/react-router";

const CACHE_TTL = 24 * 60 * 60 * 1000;
const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

function cleanTitle(value: string) {
  return value
    .replace(/\s*[-–—:]?\s*(?:season|episode|ep\.?|s\d+\s*e\d+)\s*\d+.*$/i, "")
    .replace(/\s*[-–—]\s*(?:episode|ep\.?)\s*\d+.*$/i, "")
    .trim()
    .slice(0, 120);
}

async function anilistPoster(title: string): Promise<string> {
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        query: `query ($search: String) { Media(search: $search, type: ANIME, sort: SEARCH_MATCH) { coverImage { extraLarge large } } }`,
        variables: { search: title },
      }),
    });
    if (!response.ok) return "";
    const json = (await response.json()) as {
      data?: { Media?: { coverImage?: { extraLarge?: string; large?: string } } };
    };
    return json.data?.Media?.coverImage?.extraLarge || json.data?.Media?.coverImage?.large || "";
  } catch {
    return "";
  }
}

async function tvMazePoster(title: string): Promise<string> {
  try {
    const response = await fetch(
      `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) return "";
    const json = (await response.json()) as { image?: { original?: string; medium?: string } };
    return json.image?.original || json.image?.medium || "";
  } catch {
    return "";
  }
}

async function resolvePoster(title: string, anime: boolean) {
  const key = `${anime ? "anime" : "title"}:${title.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  const active = pending.get(key);
  if (active) return active;

  const request = (async () => {
    const url = anime
      ? (await anilistPoster(title)) || (await tvMazePoster(title))
      : (await tvMazePoster(title)) || (await anilistPoster(title));
    cache.set(key, { url, expires: Date.now() + CACHE_TTL });
    pending.delete(key);
    return url;
  })();
  pending.set(key, request);
  return request;
}

export const Route = createFileRoute("/api/portrait-poster")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const title = cleanTitle(params.get("q") || "");
        if (!title) return new Response("Missing title", { status: 400 });
        const poster = await resolvePoster(title, params.get("anime") === "1");
        if (!poster) return new Response("Poster not found", { status: 404 });
        return Response.redirect(poster, 302);
      },
    },
  },
});
