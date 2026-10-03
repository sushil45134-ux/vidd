import { createFileRoute } from "@tanstack/react-router";

const SUPABASE_URL = "https://yjakihgnxntjfjvarxmt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9wUFNHVE1Lm1doB1IkeaZA_kYLeHald";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do";

const apiKey = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;

export const Route = createFileRoute("/api/config")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/site_config?select=*&limit=1`, {
            headers: {
              apikey: apiKey,
              Authorization: `Bearer ${apiKey}`,
            },
          });
          if (!res.ok) return Response.json({ data: null }, { status: 200 });
          const data = await res.json();
          return Response.json({ data: data?.[0] ?? null }, { headers: { "cache-control": "public, max-age=60" } });
        } catch {
          return Response.json({ data: null }, { status: 200 });
        }
      },
    },
  },
});
