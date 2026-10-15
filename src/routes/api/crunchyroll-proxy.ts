import { createFileRoute } from "@tanstack/react-router";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function corsHeaders(): Headers {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie, X-Requested-With");
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

export const Route = createFileRoute("/api/crunchyroll-proxy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("url");
        if (!target) {
          return new Response("url required", { status: 400, headers: corsHeaders() });
        }
        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return new Response("invalid url", { status: 400, headers: corsHeaders() });
        }
        if (!/crunchyroll\.com$/i.test(parsed.hostname) && !/\.crunchyroll\.com$/i.test(parsed.hostname)) {
          return new Response("host not allowed", { status: 403, headers: corsHeaders() });
        }

        const headers: Record<string, string> = {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        };
        // Allow passing a cookie via query param (base64) for authenticated playback.
        const cookieParam = url.searchParams.get("cookie");
        const cookie = cookieParam ? decodeURIComponent(cookieParam) : request.headers.get("cookie");
        if (cookie) headers.Cookie = cookie;

        try {
          const res = await fetch(parsed.href, { headers, redirect: "follow" });
          const contentType = res.headers.get("content-type") || "text/html";
          let body = await res.text();

          if (contentType.includes("text/html")) {
            const base = `<base href="${parsed.origin}/">`;
            if (/<head[^>]*>/i.test(body)) {
              body = body.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
            } else {
              body = `${base}${body}`;
            }
          }

          const outHeaders = corsHeaders();
          outHeaders.set("Content-Type", contentType);
          outHeaders.set("Cache-Control", "no-store");
          outHeaders.set("X-Frame-Options", "ALLOWALL");
          // Remove CSP frame-ancestors by not copying it.
          return new Response(body, { status: res.status, headers: outHeaders });
        } catch (err) {
          return new Response(`proxy error: ${err instanceof Error ? err.message : String(err)}`, {
            status: 502,
            headers: corsHeaders(),
          });
        }
      },
    },
  },
});