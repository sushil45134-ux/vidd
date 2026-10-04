import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin HLS proxy for signed embed-host playlists.
 *
 * Vidmoly's CDN expects a Vidmoly referer and does not reliably expose the
 * playlist to a browser directly. The proxy adds that referer, rewrites every
 * playlist URI through itself, and keeps playback inside our own player.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UPSTREAM_REFERER = "https://vidmoly.biz/";
const MEDIA_HOST_WHITELIST = [/(^|\.)vmpx\.online$/i, /(^|\.)vidmoly\.(me|to|biz|net)$/i];

function hostAllowed(hostname: string): boolean {
  return MEDIA_HOST_WHITELIST.some((re) => re.test(hostname));
}

function absoluteUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" && hostAllowed(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

function proxyUrl(raw: string, requestUrl: string): string {
  return `${new URL("/api/hlsproxy", requestUrl).href}?u=${encodeURIComponent(raw)}`;
}

function rewriteManifest(manifest: string, manifestUrl: string, requestUrl: string): string {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;

      // Covers audio renditions, video variants, encryption keys, and maps.
      if (line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (full, raw: string) => {
          const abs = absoluteUrl(raw, manifestUrl);
          return abs ? `URI="${proxyUrl(abs, requestUrl)}"` : full;
        });
      }

      const abs = absoluteUrl(line.trim(), manifestUrl);
      return abs ? proxyUrl(abs, requestUrl) : line;
    })
    .join("\n");
}

export const Route = createFileRoute("/api/hlsproxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const raw = (reqUrl.searchParams.get("u") || "").trim();
        let target: URL;
        try {
          target = new URL(raw);
        } catch {
          return Response.json({ ok: false, error: "valid u param required" }, { status: 400 });
        }

        if (target.protocol !== "https:" || !hostAllowed(target.hostname)) {
          return Response.json({ ok: false, error: "media host not allowed" }, { status: 403 });
        }

        try {
          const upstream = await fetch(target.href, {
            headers: {
              "User-Agent": UA,
              Referer: UPSTREAM_REFERER,
              Origin: "https://vidmoly.biz",
              Accept: "*/*",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(15000),
          });

          if (!upstream.ok) {
            return new Response(`Upstream media returned HTTP ${upstream.status}`, {
              status: upstream.status,
              headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
            });
          }

          const finalUrl = upstream.url || target.href;
          const contentType = upstream.headers.get("content-type") || "";
          const isManifest =
            /\.m3u8(?:$|[?#])/i.test(finalUrl) || /mpegurl|x-mpegurl/i.test(contentType);

          if (isManifest) {
            const text = await upstream.text();
            const body = rewriteManifest(text, finalUrl, reqUrl.href);
            return new Response(body, {
              headers: {
                "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }

          const headers = new Headers();
          const passThrough = ["Content-Type", "Content-Length", "Accept-Ranges", "Content-Range"];
          for (const name of passThrough) {
            const value = upstream.headers.get(name);
            if (value) headers.set(name, value);
          }
          headers.set("Cache-Control", "no-store");
          headers.set("Access-Control-Allow-Origin", "*");
          return new Response(upstream.body, { status: upstream.status, headers });
        } catch (e) {
          return Response.json(
            { ok: false, error: `hls proxy failed: ${e instanceof Error ? e.message : String(e)}` },
            { status: 502, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
