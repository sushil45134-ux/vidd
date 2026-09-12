/**
 * Bulk embed parsing helpers for the UploadModal "Series" flow.
 *
 * Lets the admin paste a whole season at once — a mix of full <iframe> embed
 * codes and plain URLs — and have each chunk become one episode. Also detects
 * episode numbers inside embed URLs and can auto-generate a season from a
 * single link when the host exposes a plain numeric episode segment
 * (e.g. ...?ep=1 or /episode-1).
 */

/** Result of splitting a pasted block into individual embed sources. */
export interface SplitEmbedsResult {
  /** Ordered embed URLs (iframe srcs first, then bare URLs). */
  urls: string[];
  /** Total number of raw chunks that looked like embeds/links. */
  count: number;
}

const COMPLETE_IFRAME_RE = /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi;
const OPEN_IFRAME_RE = /<iframe\b[^>]*>/gi;
const SRC_RE = /src\s*=\s*["']([^"']+)["']/i;

function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text) || /^[A-Za-z0-9_-]{11}$/.test(text);
}

/** Pull the embeddable URL out of one iframe block (or return the URL itself). */
function extractEmbedUrl(chunk: string): string | null {
  const trimmed = chunk.trim();
  if (!trimmed) return null;
  if (/<iframe\b/i.test(trimmed)) {
    let src = trimmed.match(SRC_RE)?.[1];
    // Markdown-wrapped paste: src="[https://a](https://a)" → https://a
    if (src && src.startsWith("[")) {
      src = src.match(/\((https?:\/\/[^)]+)\)/)?.[1] ?? src;
    }
    return src ? src.trim() : null;
  }
  return looksLikeUrl(trimmed) ? trimmed : null;
}

/**
 * Split pasted content into individual embed URLs. Handles the three ways
 * people paste seasons: full iframe codes (one or several), iframe opening
 * tags without a closing tag, and plain URL lists. Markdown-wrapped links
 * like [url](url) from copy/paste are also unwrapped.
 */
export function splitEmbedPastes(text: string): SplitEmbedsResult {
  const urls: string[] = [];
  let rest = text;

  const consume = (re: RegExp) => {
    rest = rest.replace(re, (block) => {
      const url = extractEmbedUrl(block);
      if (url) urls.push(url);
      return "\n";
    });
  };

  consume(COMPLETE_IFRAME_RE);
  consume(OPEN_IFRAME_RE);

  // Markdown link paste: [https://a](https://a) → https://a
  rest = rest.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_m, _label: string, url: string) => url);

  for (const line of rest.split(/[\n,;]+/)) {
    const url = extractEmbedUrl(line);
    if (url) urls.push(url);
  }

  // Drop duplicates while keeping order.
  const seen = new Set<string>();
  const unique = urls.filter((u) => {
    const key = u.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { urls: unique, count: unique.length };
}

/**
 * Detect an episode number encoded in an embed URL. Conservative on purpose —
 * only matches episode-looking patterns, never random hash IDs:
 *   ?ep=5  ?episode=5  /ep-5  /episode_5  S02E05  2x05  -e05  /e/5
 */
export function detectEpisodeNumber(url: string): number | null {
  const patterns: RegExp[] = [
    /[?&#]ep(?:isode)?=(\d{1,4})\b/i,
    /\/ep(?:isode)?[-_.]?(\d{1,4})\b/i,
    /[-_.]ep(?:isode)?[-_.](\d{1,4})\b/i,
    /\bs\d{1,2}[-_.]?e(\d{1,3})\b/i,
    /\/(\d{1,2})[-_.]x(\d{1,3})\b/,
    /[-_.]x(\d{1,3})\b/,
    /\be(?:p)?[-_.]?(\d{1,3})\b(?!\/)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 2000) return n;
    }
  }
  return null;
}

/**
 * Find an auto-incrementable numeric segment inside an embed URL. The number
 * must be a small, pure-digit token — never part of a longer hash (like
 * /video/b51a15f382ac914391a58850ab343b00). Returns the match with enough
 * context to rewrite it.
 */
interface NumericSegment {
  /** Full match text (what gets replaced). */
  token: string;
  /** 1-based value of the number. */
  value: number;
  /** Zero-pad width to preserve (e.g. "01" → 2). */
  pad: number;
}

function findIncrementableSegment(url: string): NumericSegment | null {
  // Prefer explicit episode markers: ?ep=, /episode-, -ep_, S01E..
  const candidates: Array<{ re: RegExp; group: number }> = [
    { re: /[?&#]ep(?:isode)?=(\d{1,4})\b/i, group: 1 },
    { re: /([/-]ep(?:isode)?[-_.])(\d{1,4})\b/i, group: 2 },
    { re: /(s\d{1,2}[-_.]?e)(\d{1,3})\b/i, group: 2 },
  ];
  for (const { re, group } of candidates) {
    const m = url.match(re);
    if (m) {
      const token = m[group];
      const value = parseInt(token, 10);
      if (Number.isFinite(value) && value >= 0) {
        return { token, value, pad: token.length };
      }
    }
  }
  // Fallback: last standalone pure-digit segment (e.g. /video/42, ?v=42).
  const standalone = url.match(/(?<![\w/.])(\d{1,4})(?![\w])/g);
  if (standalone && standalone.length > 0) {
    const token = standalone[standalone.length - 1];
    const value = parseInt(token, 10);
    if (Number.isFinite(value) && value >= 0 && value < 3000) {
      return { token, value, pad: token.length };
    }
  }
  return null;
}

export interface GenerateSeasonResult {
  ok: boolean;
  /** Generated embed URLs in episode order (base episode itself excluded). */
  urls?: string[];
  /** Episode number the pasted link corresponds to (1 if undetectable). */
  baseEpisode?: number;
  reason?: "no-number" | "bad-input";
}

/**
 * Try to build a whole season from ONE embed link by incrementing the numeric
 * episode segment. Returns ok:false when the URL only has unique hash IDs —
 * the caller should then ask the admin to paste every episode's iframe.
 */
export function generateSeasonFromLink(url: string, totalEpisodes: number): GenerateSeasonResult {
  if (!Number.isFinite(totalEpisodes) || totalEpisodes < 1 || totalEpisodes > 500) {
    return { ok: false, reason: "bad-input" };
  }
  const seg = findIncrementableSegment(url);
  const baseEpisode = detectEpisodeNumber(url) ?? 1;
  if (!seg) {
    return { ok: false, reason: "no-number", baseEpisode };
  }
  const pad = seg.pad;
  const format = (n: number) => String(n).padStart(pad, "0");
  const urls: string[] = [];
  for (let ep = baseEpisode + 1; ep <= totalEpisodes; ep++) {
    urls.push(url.replace(seg.token, format(ep)));
  }
  return { ok: true, urls, baseEpisode };
}

/** Pull a YouTube video id out of any common YouTube URL form. */
export function extractYouTubeId(url: string): string | undefined {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?[^#\s]*v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : undefined;
}

/** Short human label for the embed host, e.g. "As-cdn26". */
export function embedHostLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0] || "Embed";
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "Embed";
  }
}
