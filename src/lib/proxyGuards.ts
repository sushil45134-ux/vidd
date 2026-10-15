/**
 * SSRF guards shared by every route that fetches a viewer-supplied URL
 * (`/api/media-proxy`, `/api/probe`).
 */

/**
 * Reject loopback / link-local / private ranges so a route cannot be used as an
 * SSRF pivot. Self-hosters who intentionally proxy a LAN media server can opt
 * out with MEDIA_PROXY_ALLOW_LOCAL=1.
 */
export function isBlockedHost(hostname: string): boolean {
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

/** Parse a `?url=`/`?u=` value into a fetchable http(s) URL, or null. */
export function parseMediaTarget(raw: string | null | undefined): URL | null {
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
