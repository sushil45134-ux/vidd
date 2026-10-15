import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/media-proxy — generic same-origin proxy for direct media URLs.
 *
 * Why this exists
 * ---------------
 * Pasting an external `.m3u8` / `.mp4` into the site used to fail for two
 * reasons that have nothing to do with the video itself:
 *
 *   1. CORS — a cross-origin `<video>`/hls.js fetch needs the CDN to send
 *      `Access-Control-Allow-Origin`. Most OTT CDNs do not.
 *   2. Hotlink protection — many CDNs only answer when `Referer`/`Origin`
 *      point at their own site, and they answer `403` otherwise.
 *   3. No Range support meant the browser could not seek.
 *
 * This route plays the file *through our own origin*: it forwards the
 * viewer's `Range` header upstream, injects the provider's own Referer/UA,
 * and streams the bytes back with `Accept-Ranges`/`Content-Range` intact so
 * seeking, resume and quality switching all keep working.
 *
 * HLS playlists are rewritten so every segment / key / variant URL also goes
 * through this route (the CDN will not serve those to the browser directly).
 *
 * Usage:
 *   /api/media-proxy?u=<encoded absolute media URL>
 *   &referer=https://provider.example/&origin=https://provider.example
 *   &cookie=<url-encoded cookie header>
 *   &headers=<url-encoded JSON of extra headers>
 *
 * Only http(s) is allowed and private/loopback hosts are rejected (SSRF guard).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, Authorization, Cookie, X-Requested-With",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Last-Modified",
  "Access-Control-Max-Age": "86400",
};

/**
 * DRM markers a browser cannot decrypt on its own.
 *
 * AES-128 HLS (`METHOD=AES-128` with a key URI) is fine — hls.js handles it.
 * Sample-AES / Widevine / PlayReady / FairPlay / CENC key ids are not: those
 * need a license server and a hardware/sandbox CDM.
 */
const DRM_MARKERS: Array<{ re: RegExp; label: string }> = [
  { re: /com\.widevine|urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed/i, label: "Widevine" },
  { re: /com\.microsoft\.playready|urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95/i, label: "PlayReady" },
  { re: /com\.apple\.fps|urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2/i, label: "FairPlay" },
  { re: /METHOD=SAMPLE-AES/i, label: "Sample-AES" },
  { re: /cenc:default_KID/i, label: "CENC" },
];

function detectDrm(text: string): string[] {
  return DRM_MARKERS.filter(({ re }) => re.test(text)).map(({ label }) => label);
}

const PASS_THROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
  "expires",
];

/**
 * Reject loopback / link-local / private ranges so the route cannot be used as
 * an SSRF pivot. Self-hosters who intentionally proxy a LAN media server can
 * opt out with MEDIA_PROXY_ALLOW_LOCAL=1.
 */
/** Every HLS playlist starts with this tag. */
const PLAYLIST_MAGIC = /^\s*#EXTM3U/;

/** Read up to `maxBytes` from a stream, leaving the rest of the stream intact. */
async function readPrefixBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBufferLike>> {
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // Whatever arrived is still usable.
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Re-emit the bytes we sniffed, then keep streaming the upstream body. */
function streamFromPrefix(
  prefix: Uint8Array<ArrayBufferLike>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix.byteLength > 0) controller.enqueue(prefix);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {});
    },
  });
}

function isBlockedHost(hostname: string): boolean {
  // Reads through globalThis so the check also works on the edge runtime.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.MEDIA_PROXY_ALLOW_LOCAL === "1") return false;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function parseTarget(raw: string | null): URL | null {
  if (!raw) return null;
  const decoded = raw.replace(/&amp;/g, "&").trim();
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isBlockedHost(url.hostname)) return null;
  return url;
}

function proxyUrlFor(target: string, requestUrl: string, passthrough: URLSearchParams): string {
  const out = new URL("/api/media-proxy", requestUrl);
  out.searchParams.set("u", target);
  for (const [key, value] of passthrough) out.searchParams.set(key, value);
  return out.href;
}

/** Any value that is not absolute is relative to the manifest URL. */
function rewriteUri(raw: string, manifest: URL, requestUrl: string, passthrough: URLSearchParams): string {
  const value = raw.trim();
  if (!value) return raw;
  let absolute: URL;
  try {
    absolute = new URL(value, manifest);
  } catch {
    return raw;
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return raw;
  return proxyUrlFor(absolute.href, requestUrl, passthrough);
}

function rewriteManifestText(
  text: string,
  manifest: URL,
  requestUrl: string,
  passthrough: URLSearchParams,
): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      // Rewrite URI="…" / URI='…' attributes (EXT-X-KEY, EXT-X-MAP,
      // EXT-X-MEDIA audio/subtitle renditions, I-FRAME streams…).
      out.push(
        line
          .replace(/URI="([^"]*)"/g, (_m, uri: string) =>
            `URI="${rewriteUri(uri, manifest, requestUrl, passthrough)}"`,
          )
          .replace(/URI='([^']*)'/g, (_m, uri: string) =>
            `URI="${rewriteUri(uri, manifest, requestUrl, passthrough)}"`,
          ),
      );
      continue;
    }
    out.push(rewriteUri(trimmed, manifest, requestUrl, passthrough));
  }
  return out.join("\n");
}

export const Route = createFileRoute("/api/media-proxy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      HEAD: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const target = parseTarget(requestUrl.searchParams.get("u"));
        if (!target) {
          return new Response("invalid or blocked url", { status: 400, headers: CORS });
        }
        try {
          const upstream = await fetchUpstream(target, request, requestUrl, { method: "HEAD" });
          return new Response(null, { status: upstream.status, headers: outHeaders(upstream) });
        } catch (err) {
          return new Response(`proxy error: ${message(err)}`, { status: 502, headers: CORS });
        }
      },

      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const target = parseTarget(requestUrl.searchParams.get("u"));
        if (!target) {
          return new Response("invalid or blocked url", { status: 400, headers: CORS });
        }

        const passthrough = new URLSearchParams();
        for (const key of ["referer", "origin", "cookie", "headers"]) {
          const value = requestUrl.searchParams.get(key);
          if (value) passthrough.set(key, value);
        }

        try {
          const upstream = await fetchUpstream(target, request, requestUrl, { method: "GET" });

          const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
          const headerSaysPlaylist =
            contentType.includes("mpegurl") ||
            /\.m3u8(\?|$)/i.test(target.pathname) ||
            /\.m3u8(\?|$)/i.test(target.href);

          // Providers often hide the extension and send `application/octet-stream`
          // for playlists, so sniff the first bytes of the body as well. The
          // sniffed bytes are re-emitted, so nothing is lost and media files
          // still stream instead of being buffered.
          const reader = upstream.body?.getReader();
          let prefix: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
          if (reader) prefix = await readPrefixBytes(reader, 1024);
          const bodyIsPlaylist = PLAYLIST_MAGIC.test(new TextDecoder().decode(prefix));

          if (bodyIsPlaylist || headerSaysPlaylist) {
            const text = reader
              ? await new Response(streamFromPrefix(prefix, reader)).text()
              : await upstream.text();
            const headers = outHeaders(upstream, true);
            // Only relabel when the body really is a playlist — an HTML "session
            // expired" page must keep its own type so the player can say so.
            if (bodyIsPlaylist) headers.set("Content-Type", "application/vnd.apple.mpegurl");
            headers.delete("Content-Length");
            headers.delete("Content-Range");
            // Tell the player up-front when the playlist is DRM-locked, so it
            // can explain why instead of showing an empty black frame.
            const drm = detectDrm(text);
            if (drm.length > 0) {
              headers.set("X-Stream-Encrypted", "1");
              headers.set("X-Stream-Drm", drm.join(","));
            }
            return new Response(rewriteManifestText(text, target, requestUrl.href, passthrough), {
              status: upstream.status,
              headers,
            });
          }

          // Stream media straight through — never buffer, so multi-GB files and
          // Range seeks stay cheap.
          if (!reader) {
            return new Response(upstream.body, {
              status: upstream.status,
              headers: outHeaders(upstream),
            });
          }
          return new Response(streamFromPrefix(prefix, reader), {
            status: upstream.status,
            headers: outHeaders(upstream),
          });
        } catch (err) {
          return new Response(`proxy error: ${message(err)}`, { status: 502, headers: CORS });
        }
      },
    },
  },
});

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch the media, self-healing against hotlink protection.
 *
 * Anti-hotlink CDNs answer 401/403/406 when `Referer` is missing. Rather than
 * guessing up-front, retry once with the *media's own* origin as Referer (what
 * the CDN's own player would send). An explicit `referer`/`origin` param always
 * wins and is sent on the first attempt.
 */
async function fetchUpstream(
  target: URL,
  request: Request,
  requestUrl: URL,
  init: { method: "GET" | "HEAD" },
): Promise<Response> {
  const explicit = Boolean(
    requestUrl.searchParams.get("referer") || requestUrl.searchParams.get("origin"),
  );
  const response = await fetch(target.href, {
    method: init.method,
    headers: buildUpstreamHeaders(request, requestUrl),
    redirect: "follow",
  });
  if (explicit || ![401, 403, 406].includes(response.status)) return response;

  const retry = new URLSearchParams(requestUrl.searchParams);
  retry.set("referer", `${target.origin}/`);
  const headers = buildUpstreamHeaders(request, new URL(`http://x/?${retry}`));
  const retried = await fetch(target.href, {
    method: init.method,
    headers,
    redirect: "follow",
  });
  return retried.status >= 200 && retried.status < 400 ? retried : response;
}

function buildUpstreamHeaders(request: Request, requestUrl: URL): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const range = request.headers.get("range");
  if (range) headers.Range = range;

  const referer = requestUrl.searchParams.get("referer");
  const origin = requestUrl.searchParams.get("origin");
  const cookie = requestUrl.searchParams.get("cookie");
  const extra = requestUrl.searchParams.get("headers");

  // Provider hotlink protection: pretend the request came from their own site.
  if (referer && /^https?:\/\//i.test(referer)) {
    headers.Referer = referer;
    headers.Origin = origin && /^https?:\/\//i.test(origin) ? origin : new URL(referer).origin;
  } else if (origin && /^https?:\/\//i.test(origin)) {
    headers.Origin = origin;
    headers.Referer = `${origin.replace(/\/$/, "")}/`;
  }
  if (cookie) headers.Cookie = cookie;

  if (extra) {
    try {
      const parsed = JSON.parse(extra) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && /^[a-z0-9-]+$/i.test(key)) headers[key] = value;
      }
    } catch {
      // Ignore malformed header blobs — the request still works without them.
    }
  }
  return headers;
}

function outHeaders(upstream: Response, isPlaylist = false): Headers {
  const headers = new Headers(CORS);
  for (const name of PASS_THROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (isPlaylist) headers.set("Cache-Control", "no-store");
  return headers;
}
