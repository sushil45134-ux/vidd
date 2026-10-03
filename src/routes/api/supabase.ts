import { createFileRoute } from "@tanstack/react-router";

const SUPABASE_URL = "https://yjakihgnxntjfjvarxmt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9wUFNHVE1Lm1doB1IkeaZA_kYLeHald";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do";

const apiKey = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;

// Generic TV-safe proxy for Supabase tables — avoids CORS on Tizen and 127.0.0.1
export const Route = createFileRoute("/api/supabase")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const table = url.searchParams.get("table");
        if (!table) return Response.json({ error: "Missing table" }, { status: 400 });

        // Whitelist allowed tables
        const allowed = new Set(["movies", "site_config", "hero_banners", "collection_covers"]);
        if (!allowed.has(table)) return Response.json({ error: "Table not allowed" }, { status: 403 });

        // Pass through select, order, limit, etc.
        const supaUrl = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
        // Copy relevant query params
        for (const [k, v] of url.searchParams.entries()) {
          if (k === "table") continue;
          supaUrl.searchParams.append(k, v);
        }

        try {
          const res = await fetch(supaUrl.toString(), {
            headers: {
              apikey: apiKey,
              Authorization: `Bearer ${apiKey}`,
              Prefer: url.searchParams.get("count") ? "count=exact" : "",
            },
          });
          const text = await res.text();
          let data: any;
          try { data = JSON.parse(text); } catch { data = text; }
          if (!res.ok) {
            return Response.json({ error: `Supabase ${res.status}`, details: String(text).slice(0, 500) }, { status: res.status });
          }
          const countHeader = res.headers.get("content-range");
          let count: number | null = null;
          if (countHeader) {
            const parts = countHeader.split("/");
            if (parts[1]) count = Number(parts[1]);
          }
          return Response.json({ data, count }, { headers: { "cache-control": "public, max-age=30" } });
        } catch (e) {
          return Response.json({ error: "Proxy failed", details: String(e).slice(0, 500) }, { status: 500 });
        }
      },
    },
  },
});
