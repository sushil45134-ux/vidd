/**
 * Cloud storage link helpers.
 *
 * Turns Google Drive / MEGA share links into iframe-embeddable player URLs, so
 * the UploadModal "series" tabs can paste a whole season of links at once and
 * each link becomes one episode.
 */

export type CloudProvider = "drive" | "mega";

export interface CloudLink {
  /** Provider specific file identifier (Drive file id / MEGA node handle). */
  fileId: string;
  /** Player ready embed URL used by the iframe player. */
  embedUrl: string;
}

/** One episode row in the UploadModal series tabs. */
export interface CloudEpisode {
  id: string;
  fileId: string;
  title: string;
  /** Embed URL handed to EmbedPlayer. */
  url: string;
}

/* ── Google Drive ─────────────────────────────────────────────── */

export function extractDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  const patterns = [
    /drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/,
    /drive\.google\.com\/open\?id=([A-Za-z0-9_-]+)/,
    /docs\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/,
    /drive\.google\.com\/uc\?.*id=([A-Za-z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[1];
  }
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

export function isDriveLink(input: string): boolean {
  const trimmed = input.trim();
  return (
    trimmed.includes("drive.google.com") ||
    trimmed.includes("docs.google.com") ||
    /^[A-Za-z0-9_-]{20,}$/.test(trimmed)
  );
}

export function parseDriveLink(input: string): CloudLink | null {
  const fileId = extractDriveFileId(input);
  if (!fileId) return null;
  return { fileId, embedUrl: driveEmbedUrl(fileId) };
}

export function driveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

/* ── MEGA ─────────────────────────────────────────────────────── */

/**
 * Modern MEGA links: https://mega.nz/file/<handle>#<key>
 * Already-embedded links: https://mega.nz/embed/<handle>#<key>
 * Folders: https://mega.nz/folder/<handle>#<key>
 * Legacy links: https://mega.nz/#!<handle>!<key> and #F!<handle>!<key> for folders.
 */
const MEGA_MODERN_LINK =
  /mega\.(?:nz|co\.nz)\/(file|embed|folder)\/([A-Za-z0-9_-]{4,})[^#]*#([^\s"'<>]+)/i;
const MEGA_LEGACY_LINK = /mega\.(?:nz|co\.nz)\/#(F)?!([A-Za-z0-9_-]{4,})!([^\s"'<>]+)/i;

export interface ParsedMegaLink extends CloudLink {
  /** Decryption key, taken verbatim from the URL fragment (may include `!attr`). */
  key: string;
  kind: "file";
}

export function isMegaLink(input: string): boolean {
  return /mega\.(?:nz|co\.nz)/i.test(input);
}

/** Folder links cannot be expanded into episodes without the MEGA API. */
export function isMegaFolderLink(input: string): boolean {
  const trimmed = input.trim();
  const modern = trimmed.match(MEGA_MODERN_LINK);
  if (modern) return modern[1].toLowerCase() === "folder";
  const legacy = trimmed.match(MEGA_LEGACY_LINK);
  return !!legacy && !!legacy[1];
}

export function megaEmbedUrl(handle: string, key: string): string {
  return `https://mega.nz/embed/${handle}#${key}`;
}

export function parseMegaLink(input: string): ParsedMegaLink | null {
  const trimmed = input.trim();
  // Keys are base64url and may carry a trailing `!attr` part, but never
  // sentence punctuation — drop it so pasted lists stay clean.
  const cleanKey = (raw: string) => raw.replace(/[.,;:]+$/, "");

  const modern = trimmed.match(MEGA_MODERN_LINK);
  if (modern) {
    if (modern[1].toLowerCase() === "folder") return null;
    const key = cleanKey(modern[3]);
    if (!key) return null;
    return { fileId: modern[2], embedUrl: megaEmbedUrl(modern[2], key), key, kind: "file" };
  }

  const legacy = trimmed.match(MEGA_LEGACY_LINK);
  if (legacy && !legacy[1]) {
    const key = cleanKey(legacy[3]);
    if (!key) return null;
    return { fileId: legacy[2], embedUrl: megaEmbedUrl(legacy[2], key), key, kind: "file" };
  }

  return null;
}

/* ── Provider agnostic entry points ───────────────────────────── */

export function isCloudLink(provider: CloudProvider, input: string): boolean {
  return provider === "mega" ? isMegaLink(input) : isDriveLink(input);
}

export function parseCloudLink(provider: CloudProvider, input: string): CloudLink | null {
  return provider === "mega" ? parseMegaLink(input) : parseDriveLink(input);
}

/** Splits a pasted block into individual links (newline / comma / space separated). */
export function splitLinkList(input: string): string[] {
  return input
    .split(/[\n,\s]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
