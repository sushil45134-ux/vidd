import { createFileRoute } from "@tanstack/react-router";
import { fetchNxshaCatalog } from "../../lib/nxshaCatalog";

const MAX_IDS = 50;

function cleanIds(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => /^(?:tt\d{6,10}|\d{1,10})$/i.test(value)),
    ),
  ].slice(0, MAX_IDS);
}

async function load(ids: string[]) {
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await fetchNxshaCatalog(id)] as const;
      } catch (error) {
        return [
          id,
          {
            error: error instanceof Error ? error.message : "Nxsha catalogue request failed",
          },
        ] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

export const Route = createFileRoute("/api/nxsha-catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const ids = cleanIds(url.searchParams.getAll("id"));
        if (ids.length === 0) {
          return Response.json(
            { error: "At least one valid id query parameter is required" },
            { status: 400 },
          );
        }
        return Response.json(
          { catalogs: await load(ids) },
          { headers: { "cache-control": "public, max-age=1800, stale-while-revalidate=86400" } },
        );
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null);
        const ids = cleanIds(Array.isArray(body?.ids) ? body.ids : []);
        if (ids.length === 0) {
          return Response.json({ error: "A non-empty ids array is required" }, { status: 400 });
        }
        return Response.json(
          { catalogs: await load(ids) },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
