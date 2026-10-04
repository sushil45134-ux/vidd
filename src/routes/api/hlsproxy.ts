import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin HLS proxy for signed embed-host playlists.
 *
 * Vidmoly publishes each dubbed audio as a separate muxed playlist suffix
 * (a1=Hindi, a2=Tamil, a3=Telugu, a4=Japanese). The original master points
 * at a4 even though its audio rendition says Hindi is default. We therefore
 * select the requested muxed playlist explicitly instead of relying on a
 * browser's alternate-audio implementation.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UPSTREAM_REFERER = "https://vidmoly.biz/";
const MEDIA_HOST_WHITELIST = [/(^|\.)vmpx\.online$/i, /(^|\.)vidmoly\.(me|to|biz|net)$/i];
const AUDIO_SUFFIX: Record<string, string> = {
  hi: "a1",
  ta: "a2",
  te: "a3",
  ja: "a4",
};

function hostAllowed(hostname: string): boolean {
  return MEDIA_HOST_WHITELIST.some((re) => re.test(hostname));
}

function audioCode(raw: string | null): string {
  const code = (raw || "hi").toLowerCase();
  return AUDIO_SUFFIX[code] ? code : "hi";
}

function absoluteUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" && hostAllowed(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

function proxyUrl(raw: string, requestUrl: string, audio: string, quality: string): string {
  const url = new URL("/api/hlsproxy", requestUrl);
  url.searchParams.set("audio", audio);
  if (quality !== "auto") url.searchParams.set("quality", quality);
  url.searchParams.set("u", raw);
  return url.href;
}

function selectMuxedVariant(raw: string, suffix: string): string {
  // Vidmoly's video and I-frame playlists use ...-v1-aN.m3u8 / ...-v1-aN.ts.
  return raw.replace(/(-v1-)a[1-4](?=\.m3u8(?:$|[?#]))/i, `$1${suffix}`);
}

function rewriteManifest(
  manifest: string,
  manifestUrl: string,
  requestUrl: string,
  audio: string,
  quality: string,
): string {
  const suffix = AUDIO_SUFFIX[audio];
  const isMaster = manifest.includes("#EXT-X-STREAM-INF");
  let nextVariant = false;
  let keepVariant = true;

  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;

      // The selected muxed video playlist already contains the requested
      // language. Removing the alternate AUDIO group prevents Hls.js from
      // silently attaching the Japanese rendition over it.
      if (isMaster && line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) return "";

      if (isMaster && line.startsWith("#EXT-X-STREAM-INF")) {
        nextVariant = true;
        const height = Number(line.match(/RESOLUTION=\d+x(\d+)/i)?.[1] || 0);
        keepVariant = quality === "auto" || !height || String(height) === quality;
        return keepVariant ? line.replace(/,AUDIO="[^"]*"/i, "") : "";
      }

      if (isMaster && nextVariant && !line.startsWith("#")) {
        nextVariant = false;
        if (!keepVariant) return "";
        const abs = absoluteUrl(line.trim(), manifestUrl);
        return abs ? proxyUrl(selectMuxedVariant(abs, suffix), requestUrl, audio, quality) : line;
      }

      if (line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (full, raw: string) => {
          const abs = absoluteUrl(raw, manifestUrl);
          return abs ? `URI="${proxyUrl(abs, requestUrl, audio, quality)}"` : full;
        });
      }

      const abs = absoluteUrl(line.trim(), manifestUrl);
      return abs ? proxyUrl(abs, requestUrl, audio, quality) : line;
    })
    .join("\n");
}

export const Route = createFileRoute("/api/hlsproxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const raw = (reqUrl.searchParams.get("u") || "").trim();
        const audio = audioCode(reqUrl.searchParams.get("audio"));
        const requestedQuality = reqUrl.searchParams.get("quality") || "auto";
        const quality =
          requestedQuality === "720" || requestedQuality === "360" ? requestedQuality : "auto";
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
            const body = rewriteManifest(text, finalUrl, reqUrl.href, audio, quality);
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
