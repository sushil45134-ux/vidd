import { createFileRoute } from "@tanstack/react-router";
import { parseMediaTarget } from "../../lib/proxyGuards";
import { isMovieboxUrl, MOVIEBOX_HOSTS } from "../../lib/moviebox";

/**
 * /api/moviebox-frame — M2Box page ko apne server ke raaste iframe-able banao
 * ============================================================================
 * Pehla rasta hamesha seedha iframe hai (MovieboxPagePlayer "Direct Frame").
 * Agar m2box kisi din `X-Frame-Options` / CSP `frame-ancestors` laga kar
 * band kar de, to ye route wahi HTML hamare origin se deta hai: frame-rokne
 * wale headers aage hi nahi bheje jate, aur page me
 * `<base href="https://m2box.org/">` ghusa diya jata hai taaki site ke
 * saare relative JS/CSS/image usi ke origin se load hon.
 *
 * Ye jaan-boojh kar EK chhota sa HTML proxy hai, poori site ka reverse
 * proxy NAHI: sirf MovieBox ke watch/home pages (whitelist hosts) ke
 * liye hai, aur page ke andar ke API calls browser khud m2box/h5-api ko
 * karta hai. Isliye ye "best effort" fallback hai — seedha frame na
 * chale tabhi aazmao; hamara pakka rasta hamesha /api/moviebox resolver
 * (Direct Video) hai.
 *
 * Usage: /api/moviebox-frame?url=<encoded m2box page URL>
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function hostAllowed(target: URL): boolean {
  const h = target.hostname.toLowerCase();
  if (
    (MOVIEBOX_HOSTS as readonly string[]).some((known) => h === known || h.endsWith(`.${known}`))
  ) {
    return true;
  }
  // Rotated player domains (mzfi.me type) — shakal se pehchano.
  return isMovieboxUrl(target.href);
}

/** Frame-rokne wale <meta> tag hatao; headers to hum forward hi nahi karte. */
function stripFrameGuards(html: string): string {
  return html
    .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, "")
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
}

/** <head> ke seedha baad <base> daalo taaki relative assets asal site se aayein. */
function injectBase(html: string, origin: string): string {
  const baseTag = `<base href="${origin}/">`;
  // Site ka apna <base> ho to use badal do, warna <head…> ke baad ghusao.
  if (/<base\s[^>]*>/i.test(html)) return html.replace(/<base\s[^>]*>/i, baseTag);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`);
  return `${baseTag}${html}`;
}

export const Route = createFileRoute("/api/moviebox-frame")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const target = parseMediaTarget(reqUrl.searchParams.get("url"));
        if (!target || !hostAllowed(target)) {
          return new Response(
            "url galat hai — sirf MovieBox/M2Box pages proxy hote hain (e.g. https://m2box.org/movies/…?id=…)",
            { status: 400 },
          );
        }

        try {
          const upstream = await fetch(target.href, {
            headers: {
              "User-Agent": UA,
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              // Khud ko ek aam top-level navigation ki tarah pesh karo; frame
              // hone ka dava karne se kuch sites alag (khali) page deti hain.
              "Sec-Fetch-Dest": "document",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "none",
              "Upgrade-Insecure-Requests": "1",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(20000),
          });

          const contentType = upstream.headers.get("content-type") || "";
          if (!/text\/html|application\/xhtml/i.test(contentType)) {
            return new Response(
              `Upstream ne HTML nahi diya (HTTP ${upstream.status}, ${contentType || "no content-type"}). ` +
                "Direct Frame ya Direct Video try karo.",
              { status: 502 },
            );
          }

          const finalUrl = new URL(upstream.url || target.href);
          let html = await upstream.text();
          html = injectBase(stripFrameGuards(html), finalUrl.origin);

          return new Response(html, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              // Apne hi site ke frame me khulne do, bahar walon ko nahi.
              "Content-Security-Policy": "frame-ancestors 'self'",
              "X-Robots-Tag": "noindex",
              "cache-control": "no-store",
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(
            `M2Box page fetch nahi hua (${msg}). Internet/server se m2box.org ` +
              "nahi khul raha — Direct Video (resolver) try karo.",
            { status: 502 },
          );
        }
      },
    },
  },
});
