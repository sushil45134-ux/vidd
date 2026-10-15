/**
 * Shared "what kind of media is this URL?" helpers.
 *
 * These deliberately work on the *original* URL a viewer pasted, never on the
 * wrapper URL we hand to the player: `/api/media-proxy?u=https%3A%2F%2F…%2Fv.m3u8%3Ftoken`
 * has its `?` percent-encoded, so an extension test run on the wrapper would
 * treat an HLS playlist as a plain video file and the browser would answer
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` (a black player).
 */

/** True when a URL points at an HLS playlist (`.m3u8`), query string included. */
export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test((url || "").trim());
}

/** Content types that mean "this response body is an HLS playlist". */
export function isPlaylistContentType(contentType: string | null | undefined): boolean {
  return /mpegurl/i.test(contentType || "");
}

/** Image/subtitle/segment extensions that are media, never a web page. */
const MEDIA_EXTENSIONS = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|ts|m3u8)(\?|#|$)/i;

/** True for a hand-pasted CDN link that must be routed through the media proxy. */
export function isRemoteMediaUrl(url: string): boolean {
  return /^https?:\/\//i.test(url || "") && MEDIA_EXTENSIONS.test(url);
}

/** Every HLS playlist starts with this tag (a BOM is tolerated). */
const PLAYLIST_MAGIC = /^\s*#EXTM3U/;

/**
 * Read at most `maxBytes` from a response and drop the rest of the body.
 *
 * Playlists without a `.m3u8` extension are served with all sorts of content
 * types (`text/plain`, `application/octet-stream`…), so the only reliable test
 * is the first bytes of the body — and a real video file must never be read
 * into memory just to find that out.
 */
export async function readResponsePrefix(response: Response, maxBytes = 8192): Promise<string> {
  const reader = response.body?.getReader?.();
  if (!reader) return response.text().catch(() => "");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // A truncated head is still enough to recognise the playlist tag.
  }
  void reader.cancel?.().catch(() => {});
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk.subarray(0, Math.min(chunk.byteLength, size - offset)), offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export type PlaylistProbe = {
  isPlaylist: boolean;
  /** Playlist source when `isPlaylist`, otherwise the inspected prefix. */
  text: string;
  contentType: string | null;
};

/**
 * Decide whether a fetched response really is an HLS playlist.
 *
 * `sourceLooksHls` is the caller's extension-based hint (the pasted URL ends in
 * `.m3u8`); when set, the whole manifest is read because the caller needs it for
 * the quality list and the DRM check. Otherwise only a prefix is read.
 */
export async function evaluatePlaylistProbe(
  response: Response,
  sourceLooksHls: boolean,
): Promise<PlaylistProbe> {
  const contentType = response.headers.get("content-type");
  if (sourceLooksHls || isPlaylistContentType(contentType)) {
    const text = await response.text().catch(() => "");
    return { isPlaylist: PLAYLIST_MAGIC.test(text), text, contentType };
  }
  const text = await readResponsePrefix(response);
  return { isPlaylist: PLAYLIST_MAGIC.test(text), text, contentType };
}

/**
 * DRM markers a browser can never decrypt on its own.
 *
 * AES-128 HLS (`METHOD=AES-128` plus a key URI) is fine — hls.js handles it.
 * Sample-AES / Widevine / PlayReady / FairPlay / CENC key ids are not: those
 * need a licence server and a device CDM.
 */
const DRM_MARKERS: Array<[RegExp, string]> = [
  [/com\.widevine|edef8ba9-79d6-4ace-a3c8-27dcd51d21ed/i, "Widevine"],
  [/com\.microsoft\.playready|9a04f079-9840-4286-ab92-e65be0885f95/i, "PlayReady"],
  [/com\.apple\.fps|94ce86fb-07ff-4f43-adb8-93d2fa968ca2/i, "FairPlay"],
  [/METHOD=SAMPLE-AES/i, "Sample-AES"],
  [/cenc:default_KID/i, "CENC"],
];

export function detectDrm(text: string): string[] {
  return DRM_MARKERS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

export type AudioRendition = { name: string; lang: string; isDefault: boolean };

/** The `#EXT-X-MEDIA:TYPE=AUDIO` entries — the languages an HLS master ships. */
export function parseAudioRenditions(manifest: string): AudioRendition[] {
  const out: AudioRendition[] = [];
  for (const line of manifest.split(/\r?\n/)) {
    if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=AUDIO/i.test(line)) continue;
    const attr = (key: string) => {
      const quoted = line.match(new RegExp(`${key}="([^"]*)"`, "i"));
      if (quoted) return quoted[1].trim();
      const bare = line.match(new RegExp(`${key}=([^,]+)`, "i"));
      return bare ? bare[1].trim() : "";
    };
    out.push({
      name: attr("NAME") || attr("LANGUAGE") || `Track ${out.length + 1}`,
      lang: (attr("LANGUAGE") || "").toLowerCase(),
      isDefault: /YES/i.test(attr("DEFAULT")),
    });
  }
  return out;
}

/** `RESOLUTION=WxH` values from a master playlist, deduped and ascending. */
export function parseVariantHeights(manifest: string): number[] {
  const heights = new Set<number>();
  for (const match of manifest.matchAll(/RESOLUTION=\d+x(\d+)/gi)) {
    const height = Number(match[1]);
    if (Number.isInteger(height) && height > 0) heights.add(height);
  }
  return [...heights].sort((a, b) => a - b);
}

/**
 * A short, non-sensitive label for a media URL: host plus file name, never the
 * query string (CDN tokens live there). Diagnostics use it so a screenshot of
 * an error says which source failed.
 */
export function describeSource(url: string): string {
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname.startsWith("/api/")) return parsed.pathname;
    const file = parsed.pathname.split("/").filter(Boolean).pop() || "/";
    return `${parsed.host}/${file}`;
  } catch {
    return url.slice(0, 48);
  }
}
