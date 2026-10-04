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
const discoveryCache = new Map<string, { slugs: string[]; expiresAt: number }>();
const tagPageCache = new Map<string, { html: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const DISCOVERY_TTL_MS = 30 * 60 * 1000;

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

function tagSourcesFor(title: string): string[] {
  const lower = title.toLowerCase();
  const tags = lower.includes("doraemon")
    ? ["doraemon"]
    : lower.includes("shin")
      ? ["shinchan"]
      : /pokemon|pokémon/i.test(title)
        ? ["pokémon", "pokemon"]
        : [];
  return tags.flatMap((tag) =>
    [1, 2].map(
      (page) => `${TOONSTREAM_ORIGIN}/tag/${encodeURIComponent(tag)}?type=movies&page=${page}`,
    ),
  );
}

function titleTokens(value: string): string[] {
  return slugify(value)
    .split("-")
    .filter((token) => !["the", "movie", "a", "and", "of", "in", "vs"].includes(token));
}

function discoveryScore(title: string, slug: string): number {
  const wanted = new Set(titleTokens(title));
  const found = new Set(titleTokens(slug));
  if (wanted.has("doraemon") && !found.has("doraemon")) return 0;
  if (wanted.has("shin") && !found.has("shin")) return 0;
  if (wanted.has("pokemon") && !found.has("pokemon")) return 0;
  const overlap = [...wanted].filter((token) => found.has(token)).length;
  if (overlap < 2) return 0;
  return overlap / Math.max(1, wanted.size);
}

async function fetchTagPage(source: string): Promise<string | null> {
  const cached = tagPageCache.get(source);
  if (cached && cached.expiresAt > Date.now()) return cached.html;
  try {
    const response = await fetch(source, {
      headers: {
        "User-Agent": UA,
        Referer: `${TOONSTREAM_ORIGIN}/`,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    const html = response.ok ? await response.text() : null;
    tagPageCache.set(source, { html, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return html;
  } catch {
    tagPageCache.set(source, { html: null, expiresAt: Date.now() + 5 * 60 * 1000 });
    return null;
  }
}

async function discoverMovieSlugs(title: string): Promise<string[]> {
  const key = slugify(title);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.slugs;

  const candidates = new Set<string>();
  const tagPages = await Promise.all(tagSourcesFor(title).map((source) => fetchTagPage(source)));
  for (const html of tagPages) {
    if (!html) continue;
    const pattern = /(?:https?:\/\/toonstream\.us)?\/movies\/([a-z0-9][a-z0-9-]*)/gi;
    for (const match of html.matchAll(pattern)) candidates.add(match[1]);
  }

  const slugs = [...candidates]
    .map((slug) => ({ slug, score: discoveryScore(title, slug) }))
    .filter((item) => item.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.slug);
  discoveryCache.set(key, { slugs, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return slugs;
}

async function probeProvider(requestUrl: URL, providerUrl: string): Promise<boolean> {
  const extractUrl = new URL("/api/extract", requestUrl);
  const shareToken = requestUrl.searchParams.get("_vercel_share");
  if (shareToken) extractUrl.searchParams.set("_vercel_share", shareToken);
  extractUrl.searchParams.set("url", providerUrl);
  extractUrl.searchParams.set("format", "json");
  try {
    const response = await fetch(extractUrl.href, {
      headers: { Accept: "application/json", "X-Vidd-Internal": "1" },
      signal: AbortSignal.timeout(16000),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      streamUrl?: string;
    } | null;
    return response.ok && data?.ok === true && typeof data.streamUrl === "string";
  } catch {
    return false;
  }
}

function cleanUrl(raw: string): string | null {
  const decoded = raw
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/[\\"'<>]+$/g, "");
  try {
    const url = new URL(decoded);
    if (url.protocol !== "https:") return null;
    if (url.hostname === "rubystm.com" && /^\/d\/https?:\/\//i.test(url.pathname)) {
      const nested = decodeURIComponent(url.pathname.slice(3));
      return cleanUrl(nested);
    }
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

async function providerLinksForSlug(slug: string): Promise<string[]> {
  try {
    const response = await fetch(`${TOONSTREAM_ORIGIN}/movies/${slug}/`, {
      headers: {
        "User-Agent": UA,
        Referer: `${TOONSTREAM_ORIGIN}/`,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    if (/404 Not Found|Oops!/i.test(html.slice(0, 2000))) return [];
    return extractProviderLinks(html);
  } catch {
    return [];
  }
}

async function resolveProviders(title: string, year: string): Promise<string[]> {
  const key = `${title.toLowerCase()}|${year}`;
  const cached = resolveCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.urls;

  const directSlugs = candidateSlugs(title, year);
  const directResults = await Promise.all(directSlugs.map((slug) => providerLinksForSlug(slug)));
  const directLinks = directResults.find((links) => links.length > 0);
  if (directLinks) {
    resolveCache.set(key, { urls: directLinks, expiresAt: Date.now() + CACHE_TTL_MS });
    return directLinks;
  }

  const discoveredSlugs = await discoverMovieSlugs(title);
  const discoveredResults = await Promise.all(
    discoveredSlugs
      .filter((slug) => !directSlugs.includes(slug))
      .map((slug) => providerLinksForSlug(slug)),
  );
  const discoveredLinks = discoveredResults.find((links) => links.length > 0);
  if (discoveredLinks) {
    resolveCache.set(key, { urls: discoveredLinks, expiresAt: Date.now() + CACHE_TTL_MS });
    return discoveredLinks;
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

          // The catalogue preflight uses the same extraction pipeline as the
          // player. This prevents cards with only dead Rubystm/Cloudy mirrors
          // from being shown as playable.
          if (requestUrl.searchParams.get("probe") === "1") {
            const workingProviders: string[] = [];
            const probes = await Promise.all(
              providerUrls.map(async (providerUrl) => ({
                providerUrl,
                working: await probeProvider(requestUrl, providerUrl),
              })),
            );
            for (const probe of probes) {
              if (probe.working) workingProviders.push(probe.providerUrl);
            }
            if (workingProviders.length === 0) {
              return Response.json(
                { ok: false, error: "ToonStream providers are not playable" },
                { status: 404, headers: { "Cache-Control": "no-store" } },
              );
            }
            return Response.json(
              { ok: true, sources: workingProviders },
              { headers: { "Cache-Control": "no-store" } },
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
