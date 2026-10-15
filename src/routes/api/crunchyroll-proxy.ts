import { createFileRoute } from "@tanstack/react-router";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const Route = createFileRoute("/api/crunchyroll-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("url");
        if (!target) {
          return new Response("url required", { status: 400 });
        }
        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return new Response("invalid url", { status: 400 });
        }
        if (!/crunchyroll\.com$/i.test(parsed.hostname) && !/\.crunchyroll\.com$/i.test(parsed.hostname)) {
          return new Response("host not allowed", { status: 403 });
        }

        const headers: Record<string, string> = {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        };
        const cookie = request.headers.get("cookie");
        if (cookie) headers.Cookie = cookie;

        try {
          const res = await fetch(parsed.href, { headers, redirect: "follow" });
          const contentType = res.headers.get("content-type") || "text/html";
          let body = await res.text();

          // Inject a base tag so relative assets resolve against Crunchyroll.
          if (contentType.includes("text/html")) {
            const base = `<base href="${parsed.origin}/">`;
            if (/<head[^>]*>/i.test(body)) {
              body = body.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
            } else {
              body = `${base}${body}`;
            }
          }

          const outHeaders = new Headers();
          outHeaders.set("Content-Type", contentType);
          outHeaders.set("Cache-Control", "no-store");
          // Explicitly allow framing.
          outHeaders.set("X-Frame-Options", "ALLOWALL");
          return new Response(body, { status: res.status, headers: outHeaders });
        } catch (err) {
          return new Response(`proxy error: ${err instanceof Error ? err.message : String(err)}`, {
            status: 502,
          });
        }
      },
    },
  },
});