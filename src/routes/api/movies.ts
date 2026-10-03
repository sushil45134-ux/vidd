import { createFileRoute } from "@tanstack/react-router";

/**
 * TV-safe movies API — server-side proxy to Supabase.
 * 
 * Why: Samsung Tizen 5.5 (Chromium 69) and local dev origins (127.0.0.1:4173)
 * are often blocked by Supabase CORS (No 'Access-Control-Allow-Origin').
 * By fetching server-side (Nitro) we bypass CORS entirely — the TV browser
 * only ever talks to same-origin /api/movies.
 * 
 * The client (moviesRepo) will try this endpoint first, falling back to
 * direct Supabase if the proxy is unavailable.
 */

const SUPABASE_URL = "https://yjakihgnxntjfjvarxmt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9wUFNHVE1Lm1doB1IkeaZA_kYLeHald";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do";

const apiKey = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;

const MOVIES_PAGE_SIZE = 1000;
const MOVIES_COLUMNS =
  "id,title,description,image,backdrop,thumbnail_url,year,rating,duration,genre,match_score,cast_members,creator,video_url,youtube_id,embed_url,embed_platform,playlist_id,playlist_title,episode_number,season_number,is_collection,source_type,created_at";

export const Route = createFileRoute("/api/movies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const from = Number(url.searchParams.get("from") ?? "0");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? String(MOVIES_PAGE_SIZE)), MOVIES_PAGE_SIZE);
        const columns = url.searchParams.get("columns") || MOVIES_COLUMNS;
        const withCount = url.searchParams.get("count") === "1";

        try {
          // Build Supabase REST URL
          const supaUrl = new URL(`${SUPABASE_URL}/rest/v1/movies`);
          supaUrl.searchParams.set("select", columns);
          supaUrl.searchParams.set("order", "created_at.desc,id.desc");
          supaUrl.searchParams.set("offset", String(from));
          supaUrl.searchParams.set("limit", String(limit));
          if (withCount) {
            supaUrl.searchParams.set("select", columns);
            // PostgREST count via Prefer header, but we can also get via separate request
          }

          const headers: Record<string, string> = {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          };
          if (withCount) {
            headers["Prefer"] = "count=exact";
          }

          const res = await fetch(supaUrl.toString(), { headers });

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return Response.json({ error: `Supabase error ${res.status}`, details: text.slice(0, 500) }, { status: res.status });
          }

          const data = await res.json();
          const countHeader = res.headers.get("content-range");
          let total: number | null = null;
          if (countHeader) {
            const parts = countHeader.split("/");
            if (parts[1]) total = Number(parts[1]);
          }

          return Response.json(
            { data, count: total },
            {
              headers: {
                "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
                "access-control-allow-origin": "*",
              },
            }
          );
        } catch (e) {
          return Response.json({ error: "Proxy fetch failed", details: String(e).slice(0, 500) }, { status: 500 });
        }
      },
    },
  },
});
