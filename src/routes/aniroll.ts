import { createFileRoute } from "@tanstack/react-router";

/**
 * `/aniroll` → the AniRoll UI (static page in public/aniroll/, wired to vid's
 * /api/aniroll catalogue). Pretty URL only — the page itself is served as-is.
 */
export const Route = createFileRoute("/aniroll")({
  server: {
    handlers: {
      GET: async () =>
        new Response(null, {
          status: 308,
          headers: { Location: "/aniroll/index.html", "cache-control": "public, max-age=300" },
        }),
    },
  },
});
