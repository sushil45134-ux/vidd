import { createFileRoute } from "@tanstack/react-router";

const TMDB = "https://www.themoviedb.org";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function html(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  if (!res.ok) return "";
  return res.text();
}

async function resolveTmdbId(query: string) {
  const direct = query.match(/(?:^|\/)(\d{1,10})(?:$|[/?-])/);
  if (direct) return direct[1];
  const search = await html(
    `${TMDB}/search/tv?query=${encodeURIComponent(query)}&language=en-US`,
  );
  return search.match(/\/tv\/(\d{1,10})(?:[-"?])/i)?.[1] || "";
}

function youtubeIds(page: string) {
  // Return every TMDB trailer candidate. A publisher can disable embedding or
  // block one upload by region, so the client automatically tries the next
  // official trailer instead of leaving YouTube's "Video unavailable" card.
  return Array.from(page.matchAll(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,})/gi))
    .map((match) => match[1])
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 8);
}

export const Route = createFileRoute("/api/anime-trailer")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return Response.json({ error: "q required" }, { status: 400 });
        try {
          const tmdbId = await resolveTmdbId(q);
          if (!tmdbId) return Response.json({ youtubeId: "", youtubeIds: [], tmdbId: "" });
          const videos = await html(
            `${TMDB}/tv/${tmdbId}/videos?active_nav_item=Trailers&language=en-US`,
          );
          const candidates = youtubeIds(videos);
          return Response.json(
            { youtubeId: candidates[0] || "", youtubeIds: candidates, tmdbId },
            { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } },
          );
        } catch {
          // Trailer is progressive enhancement: the modal always retains its
          // poster fallback when TMDB/YouTube is unavailable.
          return Response.json({ youtubeId: "", youtubeIds: [], tmdbId: "" });
        }
      },
    },
  },
});
