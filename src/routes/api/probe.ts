import { createFileRoute } from "@tanstack/react-router";
import {
  detectDrm,
  evaluatePlaylistProbe,
  isHlsUrl,
  isRemoteMediaUrl,
  parseAudioRenditions,
  parseVariantHeights,
} from "../../lib/videoSource";
import { isBlockedHost } from "../../lib/proxyGuards";

/**
 * /api/probe — "will this link actually play?" check for the Add Movie form.
 *
 * The player used to be the only place a bad link showed up, and all it could
 * say was `MEDIA_ERR_SRC_NOT_SUPPORTED`. This route answers the question at the
 * moment the link is pasted:
 *
 *   /api/probe?url=<encoded media url>
 *   → { ok, kind, status, contentType, isPlaylist, languages[], qualities[],
 *       drm[], note }
 *
 * Only a bounded prefix of the body is read for non-playlists, so probing a
 * multi-GB file is cheap.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type ProbeResult = {
  ok: boolean;
  kind: "hls" | "file" | "drm" | "not-media" | "error";
  status?: number;
  contentType?: string | null;
  isPlaylist?: boolean;
  languages?: Array<{ name: string; lang: string; isDefault: boolean }>;
  qualities?: number[];
  drm?: string[];
  note: string;
};

function json(result: ProbeResult): Response {
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function targetUrl(raw: string | null): URL | null {
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

export const Route = createFileRoute("/api/probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const target = targetUrl(requestUrl.searchParams.get("url"));
        if (!target) {
          return json({ ok: false, kind: "error", note: "That is not a usable http(s) media link." });
        }

        const looksHls = isHlsUrl(target.href);
        const looksMedia = isRemoteMediaUrl(target.href);

        let upstream: Response;
        try {
          // The link usually works for the provider's own player *and* when the
          // browser sends a matching Referer — retry the same way the proxy does.
          // Fetch metadata the way a browser page asks for media: a bare server
          // request is refused by some CDNs (net52) even when the link is fine.
          const browserish = {
            "User-Agent": UA,
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
          };
          upstream = await fetch(target.href, { headers: browserish, redirect: "follow" });
          if ([401, 403, 406].includes(upstream.status)) {
            const retried = await fetch(target.href, {
              headers: {
                ...browserish,
                Referer: `${target.origin}/`,
                Origin: target.origin,
              },
              redirect: "follow",
            });
            if (retried.status < 400) upstream = retried;
          }
        } catch (err) {
          return json({
            ok: false,
            kind: "error",
            note: `Could not reach the server: ${err instanceof Error ? err.message : String(err)}`,
          });
        }

        const status = upstream.status;
        if (status >= 400) {
          const refused = /401|403|406/.test(String(status));
          return json({
            ok: false,
            kind: "error",
            status,
            note: refused
              ? `Our server was refused (HTTP ${status}) — this CDN may block server-side requests, or the signed link expired. The player will still try playing it directly in the viewer's browser; if that fails too, copy a fresh URL from the source page.`
              : status === 410
                ? `The server answered HTTP 410 (gone) — a signed link that has expired. Copy a fresh URL from the source page.`
                : `The server answered HTTP ${status} for this link.`,
          });
        }

        const probe = await evaluatePlaylistProbe(upstream, looksHls).catch(() => null);
        const contentType = probe?.contentType ?? upstream.headers.get("content-type");

        if (probe?.isPlaylist) {
          const languages = parseAudioRenditions(probe.text);
          const drm = detectDrm(probe.text);
          if (drm.length > 0) {
            return json({
              ok: false,
              kind: "drm",
              status,
              contentType,
              isPlaylist: true,
              languages,
              drm,
              note: `This stream is DRM-protected (${drm.join(", ")}) — no browser can play it without the service's licence. Use a non-DRM source.`,
            });
          }
          return json({
            ok: true,
            kind: "hls",
            status,
            contentType,
            isPlaylist: true,
            languages,
            qualities: parseVariantHeights(probe.text),
            drm: [],
            note:
              languages.length > 1
                ? `Playable HLS stream with ${languages.length} audio languages (${languages
                    .map((l) => l.name)
                    .join(", ")}). The player will show an Audio selector.`
                : languages.length === 1
                  ? `Playable HLS stream with a single audio language (${languages[0].name}). For multi-audio, paste the master URL that lists several EXT-X-MEDIA entries.`
                  : "Playable HLS stream with a single audio track (the playlist lists no separate languages).",
          });
        }

        if (looksMedia) {
          // A media-looking address that answered with HTML/JSON is not a file
          // at all — usually an expired/blocked link or a player page.
          const servedPage = /text\/html|application\/json/i.test(contentType || "");
          if (servedPage) {
            const tokenish = /(^|[?&])(in|expires|sign|signature|token|md5|policy|key-pair-id)=/i.test(
              target.search,
            );
            return json({
              ok: false,
              kind: "not-media",
              status,
              contentType,
              isPlaylist: false,
              note: tokenish
                ? `The server answered with a web page (${contentType}) instead of the stream — these CDN links are signed and short-lived, so this one has most likely expired. Start the video again on the source page and copy a fresh URL (or take it straight from the browser's network tab).`
                : `The server answered with a web page (${contentType}) instead of the stream. Open the page, start the video, then copy the real .m3u8/.mp4 address from the browser's network tab.`,
            });
          }
          return json({
            ok: true,
            kind: "file",
            status,
            contentType,
            isPlaylist: false,
            note: `Direct media file (${contentType || "unknown type"}). A file without audio is usually a DASH/DRM track published separately — browsers cannot play those on their own.`,
          });
        }

        return json({
          ok: false,
          kind: "not-media",
          status,
          contentType,
          isPlaylist: false,
          note: `This address returned "${contentType || "an unknown type"}" and not a media playlist — it is probably a web page, not the video file. Open the page, start the video, then copy the .m3u8/.mp4 address from the browser's network tab.`,
        });
      },
    },
  },
});
