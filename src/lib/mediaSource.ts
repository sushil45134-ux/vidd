/**
 * Media source detection + HLS loader
 * ===================================
 * Decides which URLs Vidd can play in its OWN player (`ViddPlayer`) instead
 * of handing them to a third-party iframe.
 *
 * WHY THIS MATTERS
 * ----------------
 * A cross-origin embed (Nxsha & co.) owns everything inside its rectangle:
 * its controls, its fullscreen, its rotation. The browser will not let a
 * parent page reach in — that is a security guarantee, not a bug we can
 * work around. The only way to truly own the playback experience is to play
 * the media ourselves. Anything this module recognises gets Vidd's player.
 */

/** Progressive files a <video> element can play directly. */
const FILE_EXTENSIONS = ["mp4", "m4v", "webm", "ogv", "ogg", "mov", "mkv"];

/** Adaptive streaming manifests. */
const HLS_EXTENSIONS = ["m3u8"];
const DASH_EXTENSIONS = ["mpd"];

function pathExtension(url: string): string {
  try {
    const { pathname } = new URL(url, "https://vidd.local");
    const last = pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    return dot === -1 ? "" : last.slice(dot + 1).toLowerCase();
  } catch {
    return "";
  }
}

/** HLS manifest (`.m3u8`), the format most stream providers hand out. */
export function isHlsUrl(url: string): boolean {
  if (!url) return false;
  if (/^blob:/i.test(url)) return false;
  return HLS_EXTENSIONS.includes(pathExtension(url)) || /\.m3u8(\?|#|$)/i.test(url);
}

/** MPEG-DASH manifest — only playable where the browser supports it natively. */
export function isDashUrl(url: string): boolean {
  if (!url) return false;
  return DASH_EXTENSIONS.includes(pathExtension(url));
}

/**
 * True when Vidd can play this itself. Blob/object URLs (fresh uploads) and
 * data URLs always qualify; everything else is decided by extension.
 */
export function isDirectMediaUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^blob:/i.test(trimmed) || /^data:video\//i.test(trimmed)) return true;
  if (isHlsUrl(trimmed)) return true;
  if (isDashUrl(trimmed)) return true;
  return FILE_EXTENSIONS.includes(pathExtension(trimmed));
}

/**
 * Pick the URL Vidd's own player should use for a title, or `null` when the
 * only thing on file is a third-party embed.
 *
 * `videoUrl` wins over `embedUrl`: an uploaded/direct file is always the
 * better source than a page that happens to end in `.mp4`.
 */
export function pickDirectSource(source: { videoUrl?: string; embedUrl?: string }): string | null {
  if (isDirectMediaUrl(source.videoUrl)) return source.videoUrl as string;
  if (isDirectMediaUrl(source.embedUrl)) return source.embedUrl as string;
  return null;
}

/** Safari / iOS play HLS in the <video> element without any library. */
export function hasNativeHlsSupport(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("video");
  return (
    probe.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    probe.canPlayType("application/x-mpegURL") !== ""
  );
}

/* ------------------------------------------------------------------ *
 * hls.js
 * ------------------------------------------------------------------ */

/**
 * Loaded from a CDN at runtime rather than added to package.json.
 *
 * The repo ships two lockfiles (bun.lock + package-lock.json) and a
 * `minimumReleaseAge` supply-chain guard in bunfig.toml, so adding a
 * dependency here risks drift between the two installers on Vercel. The
 * Dailymotion SDK is already loaded the same way in EmbedPlayer, so this
 * follows an established pattern. If the CDN is unreachable the player
 * falls back to native playback and simply reports an error for HLS.
 */
const HLS_CDN_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js";

type HlsConstructor = {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: Record<string, string>;
  ErrorTypes: Record<string, string>;
};

export interface HlsLevel {
  height?: number;
  width?: number;
  bitrate?: number;
  name?: string;
}

export interface HlsTrack {
  id?: number;
  name?: string;
  lang?: string;
}

export interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  destroy(): void;
  startLoad(): void;
  recoverMediaError(): void;
  on(event: string, cb: (event: string, data: unknown) => void): void;
  levels: HlsLevel[];
  currentLevel: number;
  audioTracks: HlsTrack[];
  audioTrack: number;
  subtitleTracks: HlsTrack[];
  subtitleTrack: number;
  subtitleDisplay: boolean;
}

let hlsPromise: Promise<HlsConstructor | null> | null = null;

/** Load hls.js once per page. Resolves `null` when it cannot be loaded. */
export function loadHlsJs(): Promise<HlsConstructor | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const existing = (window as unknown as { Hls?: HlsConstructor }).Hls;
  if (existing) return Promise.resolve(existing);
  if (hlsPromise) return hlsPromise;

  hlsPromise = new Promise<HlsConstructor | null>((resolve) => {
    const script = document.createElement("script");
    script.src = HLS_CDN_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve((window as unknown as { Hls?: HlsConstructor }).Hls ?? null);
    script.onerror = () => {
      hlsPromise = null; // allow a later retry
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return hlsPromise;
}

/** Human label for an HLS quality level. */
export function levelLabel(level: HlsLevel, index: number): string {
  if (level.height) return `${level.height}p`;
  if (level.name) return level.name;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
  return `Level ${index + 1}`;
}

/** Human label for an audio/subtitle track. */
export function trackLabel(track: HlsTrack, index: number): string {
  return track.name || track.lang || `Track ${index + 1}`;
}
