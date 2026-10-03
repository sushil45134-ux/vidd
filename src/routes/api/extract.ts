import { createFileRoute } from "@tanstack/react-router";

/**
 * Embed-host stream extractor — server-side. (v2: debug mode + hardened)
 *
 * Problem: free video hosts (Vidmoly, Cloudy/UPNShare, RubyStm/StreamWish…)
 * refuse to play inside a sandboxed iframe ("Sandboxed player not allowed")
 * because the sandbox blocks their popup ads. We keep the sandbox (no popups
 * on our site, ever) and instead pull the ACTUAL video URL (m3u8/mp4) out of
 * their embed page server-side, then play it in our own <video> player.
 *
 * Usage:
 *   /api/extract?url=<encoded embed URL>            → 302 to the raw stream
 *   /api/extract?url=…&format=json                  → { ok, streamUrl, kind }
 *   /api/extract?url=…&format=json&debug=1          → + per-attempt trace with
 *                                                      HTTP status, final URL
 *                                                      and an HTML snippet
 *
 * Only whitelisted hosts are fetched (SSRF guard). Results are cached
 * briefly; extracted URLs are usually signed + expiring.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_REFERER = "https://toonstream.us/";

const HOST_WHITELIST = [
  /(^|\.)vidmoly\.(me|to|biz|net)$/i,
  /(^|\.)rubystm\.com$/i,
  /(^|\.)rubyvid(hub)?\.com$/i,
  /(^|\.)streamwish\.(to|com)$/i,
  /(^|\.)upns\.(one|xyz)$/i,
  /(^|\.)upnshare\.com$/i,
  /(^|\.)filemoon\.(sx|to)$/i,
];

function hostAllowed(hostname: string): boolean {
  return HOST_WHITELIST.some((re) => re.test(hostname));
}

type Found = { url: string; kind: "hls" | "mp4" };
type Attempt = {
  url: string;
  referer: string;
  status?: number;
  finalUrl?: string;
  bytes?: number;
  packed?: boolean;
  error?: string;
  snippet?: string;
};

type CacheEntry = Found & { expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Dean Edwards p.a.c.k.e.r unpacker — these hosts hide player config in it. */
function unpackOne(packed: string): string {
  const m = packed.match(
    /eval\(function\(p,a,c,k,e,[dr]?\)\{.*?\}\('((?:[^'\\]|\\.)*)',(\d+),(\d+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/s,
  );
  if (!m) return "";
  const payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const radix = parseInt(m[2], 10);
  const count = parseInt(m[3], 10);
  const words = m[4].split("|");
  const encode = (n: number): string => {
    const digit = (d: number) =>
      d < 36 ? d.toString(36) : String.fromCharCode(d - 36 + 65);
    return (n < radix ? "" : encode(Math.floor(n / radix))) + digit(n % radix);
  };
  const dict = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const key = encode(i);
    dict.set(key, words[i] || key);
  }
  return payload.replace(/\b\w+\b/g, (w) => dict.get(w) ?? w);
}

/** Unpack EVERY packed block on the page, concatenated. */
function unpackAll(page: string): string {
  let out = "";
  const re = /eval\(function\(p,a,c,k,e,[dr]?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(page))) {
    const chunk = unpackOne(page.slice(m.index));
    if (chunk) out += "\n" + chunk;
  }
  return out;
}

/** Resolve relative / protocol-relative URLs against the page URL. */
function absolutize(u: string, base: string): string {
  try {
    return new URL(u.replace(/\\\//g, "/"), base).href;
  } catch {
    return u;
  }
}

function classify(u: string): "hls" | "mp4" {
  return /\.m3u8(\?|$|#)/.test(u) || u.includes(".m3u8") ? "hls" : "mp4";
}

function findStream(text: string, baseUrl: string): Found | null {
  // Normalise JSON-escaped slashes so patterns match either form.
  const t = text.replace(/\\\//g, "/");
  const patterns = [
    // jwplayer-style config: sources: [{file:"…"}] / {src:"…"}
    /sources\s*:\s*\[\s*\{\s*["']?(?:file|src)["']?\s*:\s*["']([^"']+)["']/i,
    // bare file:/src: pointing at a playlist or mp4 (abs, protocol-relative or relative)
    /["']?(?:file|src)["']?\s*:\s*["']((?:https?:)?\/\/[^"']+|[^"':]+?\.(?:m3u8|mp4)[^"']*)["']/i,
    // <source src="…">
    /<source[^>]+src=["']([^"']+)["']/i,
    // any absolute or protocol-relative m3u8 / mp4 URL in the page
    /["']((?:https?:)?\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
    /["']((?:https?:)?\/\/[^"'\s]+\.mp4(?:\?[^"'\s]*)?)["']/i,
    // unquoted m3u8 (inside unpacked code)
    /((?:https?:)?\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const abs = absolutize(m[1], baseUrl);
    if (!/^https?:\/\//.test(abs)) continue;
    // Ignore obvious non-media hits (ads/js/css/posters)
    if (/\.(js|css|png|jpe?g|webp|svg|ico|vtt|srt)(\?|$)/i.test(abs)) continue;
    if (!/\.(m3u8|mp4)(\?|$|#)/i.test(abs) && !/m3u8/.test(abs)) continue;
    return { url: abs, kind: classify(abs) };
  }
  return null;
}

async function fetchPage(
  url: string,
  referer: string,
): Promise<{ text: string; status: number; finalUrl: string }> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Upgrade-Insecure-Requests": "1",
  };
  if (referer) headers.Referer = referer;
  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  return { text, status: res.status, finalUrl: res.url || url };
}

/**
 * For a given target, list page-URL variants worth trying.
 * Vidmoly serves the same video at /embed-{id}.html, /w/{id}, /v/{id}.
 * StreamWish-family (rubystm): /e/{id}.html is the embed page.
 */
function candidateUrls(target: URL): string[] {
  const href = target.href;
  const out: string[] = [href];
  if (/vidmoly\./i.test(target.hostname)) {
    const m = target.pathname.match(/(?:embed-|\/(?:w|v|dl)\/)([A-Za-z0-9]+)/);
    if (m?.[1]) {
      const id = m[1];
      for (const v of [
        `https://${target.hostname}/embed-${id}.html`,
        `https://${target.hostname}/w/${id}`,
        `https://${target.hostname}/v/${id}`,
      ]) {
        if (!out.includes(v)) out.push(v);
      }
    }
  }
  if (/rubystm\.|rubyvid|streamwish\.|filemoon\./i.test(target.hostname)) {
    const m = target.pathname.match(/\/(?:d|e|f|v)\/([A-Za-z0-9]+)/);
    if (m?.[1]) {
      const e = `https://${target.hostname}/e/${m[1]}.html`;
      if (!out.includes(e)) out.unshift(e);
    }
  }
  return out;
}

/** UPNShare/Cloudy players load their stream from a JSON API, not the page. */
async function extractUpns(
  target: URL,
  attempts: Attempt[],
): Promise<Found | null> {
  const id = (target.hash || "").replace(/^#/, "").split("&")[0];
  if (!id) return null;
  const candidates = [
    `${target.origin}/api/v1/video?id=${id}&w=1920&h=1080&r=${encodeURIComponent("toonstream.us")}`,
    `${target.origin}/api/v1/video?id=${id}`,
  ];
  for (const api of candidates) {
    const at: Attempt = { url: api, referer: target.href };
    attempts.push(at);
    try {
      const { text, status, finalUrl } = await fetchPage(api, target.href);
      at.status = status;
      at.finalUrl = finalUrl;
      at.bytes = text.length;
      at.snippet = text.slice(0, 1200);
      try {
        const data = JSON.parse(text);
        const flat = JSON.stringify(data);
        const found = findStream(flat, target.href);
        if (found) return found;
        const direct =
          data?.url || data?.source || data?.file || data?.src ||
          data?.sources?.[0]?.file || data?.sources?.[0]?.url;
        if (typeof direct === "string") {
          const abs = absolutize(direct, target.href);
          if (/^https?:\/\//.test(abs)) return { url: abs, kind: classify(abs) };
        }
      } catch {
        const found = findStream(text, target.href);
        if (found) return found;
      }
    } catch (e) {
      at.error = e instanceof Error ? e.message : String(e);
    }
  }
  return null;
}

async function extractGeneric(
  target: URL,
  attempts: Attempt[],
): Promise<Found | null> {
  const referers = [DEFAULT_REFERER, `${target.origin}/`, ""];
  for (const pageUrl of candidateUrls(target)) {
    for (const referer of referers) {
      const at: Attempt = { url: pageUrl, referer };
      attempts.push(at);
      let page = "";
      try {
        const { text, status, finalUrl } = await fetchPage(pageUrl, referer);
        page = text;
        at.status = status;
        at.finalUrl = finalUrl;
        at.bytes = text.length;
        at.packed = text.includes("eval(function(p,a,c,k,e,");
        at.snippet = text.slice(0, 1500);
      } catch (e) {
        at.error = e instanceof Error ? e.message : String(e);
        continue;
      }

      let found = findStream(page, pageUrl);
      if (!found && at.packed) {
        const unpacked = unpackAll(page);
        if (unpacked) {
          found = findStream(unpacked, pageUrl);
          if (!found) at.snippet = unpacked.slice(0, 1500);
        }
      }
      if (found) return found;

      // Follow ONE nested iframe to a whitelisted host (some embeds are shells).
      const iframe = page.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframe?.[1]) {
        const nested = absolutize(iframe[1], pageUrl);
        try {
          const nestedUrl = new URL(nested);
          if (nestedUrl.protocol === "https:" && hostAllowed(nestedUrl.hostname)) {
            const at2: Attempt = { url: nested, referer: pageUrl };
            attempts.push(at2);
            try {
              const { text, status, finalUrl } = await fetchPage(nested, pageUrl);
              at2.status = status;
              at2.finalUrl = finalUrl;
              at2.bytes = text.length;
              at2.packed = text.includes("eval(function(p,a,c,k,e,");
              at2.snippet = text.slice(0, 1500);
              let f2 = findStream(text, nested);
              if (!f2 && at2.packed) {
                const un2 = unpackAll(text);
                if (un2) f2 = findStream(un2, nested);
              }
              if (f2) return f2;
            } catch (e) {
              at2.error = e instanceof Error ? e.message : String(e);
            }
          }
        } catch {
          /* bad nested URL — ignore */
        }
      }
    }
  }
  return null;
}

export const Route = createFileRoute("/api/extract")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const raw = (reqUrl.searchParams.get("url") || "").trim();
        const wantJson = reqUrl.searchParams.get("format") === "json";
        const wantDebug = reqUrl.searchParams.get("debug") === "1";

        let target: URL;
        try {
          target = new URL(raw);
        } catch {
          return Response.json({ ok: false, error: "valid url param required" }, { status: 400 });
        }
        if (target.protocol !== "https:" || !hostAllowed(target.hostname)) {
          return Response.json({ ok: false, error: "host not allowed" }, { status: 403 });
        }

        const cacheKey = target.href;
        const hit = cache.get(cacheKey);
        if (hit && hit.expiresAt > Date.now() && !wantDebug) {
          return wantJson
            ? Response.json({ ok: true, cached: true, streamUrl: hit.url, kind: hit.kind }, { headers: { "Cache-Control": "no-store" } })
            : new Response(null, { status: 302, headers: { Location: hit.url, "Cache-Control": "no-store" } });
        }

        const attempts: Attempt[] = [];
        try {
          const isUpns = /upns\.|upnshare\./i.test(target.hostname);
          const found = isUpns
            ? await extractUpns(target, attempts)
            : await extractGeneric(target, attempts);
          if (!found) {
            const body: Record<string, unknown> = { ok: false, error: "no stream found in embed page" };
            if (wantDebug) body.attempts = attempts;
            return Response.json(body, { status: 404, headers: { "Cache-Control": "no-store" } });
          }
          cache.set(cacheKey, { ...found, expiresAt: Date.now() + CACHE_TTL_MS });
          if (wantJson || wantDebug) {
            const body: Record<string, unknown> = { ok: true, cached: false, streamUrl: found.url, kind: found.kind };
            if (wantDebug) {
              body.attempts = attempts.map(({ snippet, ...rest }) => rest);
            }
            return Response.json(body, { headers: { "Cache-Control": "no-store" } });
          }
          return new Response(null, { status: 302, headers: { Location: found.url, "Cache-Control": "no-store" } });
        } catch (e) {
          const body: Record<string, unknown> = {
            ok: false,
            error: `extract failed: ${e instanceof Error ? e.message : String(e)}`,
          };
          if (wantDebug) body.attempts = attempts;
          return Response.json(body, { status: 502, headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});
