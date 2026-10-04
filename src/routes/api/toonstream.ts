import { createFileRoute } from "@tanstack/react-router";

/**
 * Resolve a movie from the same ToonStream catalogue used by the Preview
 * Doraemon demo. Nxsha rows are kept in the database as historical records,
 * but the player never opens those embeds anymore: it asks this route for the
 * matching ToonStream download link, preferring Vidmoly/Moly (the working
 * Doraemon source) and then the other extractable ToonStream mirrors.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TOONSTREAM_ORIGIN = "https://toonstream.us";
const PROVIDER_ORDER = ["vidmoly", "rubystm", "upns.one", "upnshare"];
const resolveCache = new Map<string, { urls: string[]; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function candidateSlugs(title: string, year: string): string[] {
  const values = [
    title,
    title.replace(/\s+the\s+movie\s*:/i, ":"),
    title.replace(/\s+the\s+movie\s*/i, " "),
  ];
  if (/crayon\s+shin-?chan/i.test(title)) {
    values.push(
      title.replace(/crayon\s+shin-?chan/i, "Crayon Shinchan"),
      title.replace(/crayon\s+shin-?chan/i, "Shin-chan"),
      title.replace(/crayon\s+shin-?chan/i, "Shinchan"),
    );
  }
  if (year) values.push(title.replace(new RegExp(`\\s*${year}\\s*$`), ""));
  return [...new Set(values.map(slugify).filter(Boolean))];
}

function cleanUrl(raw: string): string | null {
  const decoded = raw
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/[\\"'<>]+$/g, "");
  try {
    const url = new URL(decoded);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (
      !host.includes("vidmoly.") &&
      !host.endsWith("rubystm.com") &&
      !host.endsWith("upns.one") &&
      !host.endsWith("upnshare.com")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function providerRank(url: string): number {
  const host = new URL(url).hostname.toLowerCase();
  const index = PROVIDER_ORDER.findIndex((name) => host.includes(name));
  return index >= 0 ? index : PROVIDER_ORDER.length;
}

function extractProviderLinks(html: string): string[] {
  const links = new Set<string>();
  const pattern = /https?:\/\/[^\s"'<>]+/gi;
  for (const match of html.matchAll(pattern)) {
    const url = cleanUrl(match[0]);
    if (url) links.add(url);
  }
  return [...links].sort((a, b) => providerRank(a) - providerRank(b));
}

async function resolveProviders(title: string, year: string): Promise<string[]> {
  const key = `${title.toLowerCase()}|${year}`;
  const cached = resolveCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.urls;

  for (const slug of candidateSlugs(title, year)) {
    try {
      const response = await fetch(`${TOONSTREAM_ORIGIN}/movies/${slug}/`, {
        headers: {
          "User-Agent": UA,
          Referer: `${TOONSTREAM_ORIGIN}/`,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) continue;
      const html = await response.text();
      if (/404 Not Found|Oops!/i.test(html.slice(0, 2000))) continue;
      const links = extractProviderLinks(html);
      if (links.length > 0) {
        resolveCache.set(key, { urls: links, expiresAt: Date.now() + CACHE_TTL_MS });
        return links;
      }
    } catch {
      // Try the next harmless slug candidate.
    }
  }

  resolveCache.set(key, { urls: [], expiresAt: Date.now() + 5 * 60 * 1000 });
  return [];
}

export const Route = createFileRoute("/api/toonstream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const title = (requestUrl.searchParams.get("title") || "").trim();
        const year = (requestUrl.searchParams.get("year") || "").trim();
        if (!title) return Response.json({ ok: false, error: "title required" }, { status: 400 });

        try {
          const providerUrls = await resolveProviders(title, year);
          if (providerUrls.length === 0) {
            return Response.json(
              { ok: false, error: "ToonStream source not found for this title" },
              { status: 404, headers: { "Cache-Control": "no-store" } },
            );
          }

          // The player asks for all ranked mirrors so it can keep trying the
          // next real provider if a host such as Rubystm is temporarily behind
          // a challenge. Direct callers retain the original first-provider
          // redirect behaviour.
          if (requestUrl.searchParams.get("sources") === "1") {
            return Response.json(
              { ok: true, sources: providerUrls },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          const extractUrl = new URL("/api/extract", requestUrl);
          extractUrl.searchParams.set("url", providerUrls[0]);
          extractUrl.searchParams.set("format", "json");
          return Response.redirect(extractUrl.href, 302);
        } catch (error) {
          return Response.json(
            {
              ok: false,
              error: error instanceof Error ? error.message : "ToonStream resolve failed",
            },
            { status: 502, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
