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
