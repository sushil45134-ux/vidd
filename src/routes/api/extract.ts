import { createFileRoute } from "@tanstack/react-router";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  REF = "https://toonstream.us/";
const allowed = [
  /(^|\.)vidmoly\.(me|to|biz|net)$/i,
  /(^|\.)rubystm\.com$/i,
  /(^|\.)rubyvid(hub)?\.com$/i,
  /(^|\.)streamwish\.(to|com)$/i,
  /(^|\.)upns\.(one|xyz)$/i,
  /(^|\.)upnshare\.com$/i,
  /(^|\.)filemoon\.(sx|to)$/i,
];
type F = { url: string; kind: "hls" | "mp4" };
type C = F & { expiresAt: number };
const cache = new Map<string, C>();
function find(t: string): F | null {
  const rs = [
    /sources\s*:\s*\[\s*\{\s*(?:file|src)\s*:\s*["']([^"']+)["']/i,
    /(?:file|src)\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /(?:file|src)\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    /["'](https?:\/\/[^"']+\.mp4\?[^"']*)["']/i,
  ];
  for (const r of rs) {
    const m = t.match(r);
    if (m?.[1]?.startsWith("http"))
      return { url: m[1], kind: m[1].includes(".m3u8") ? "hls" : "mp4" };
  }
  return null;
}
async function text(u: string, referer: string) {
  const r = await fetch(u, {
    headers: {
      "User-Agent": UA,
      Referer: referer,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  return r.text();
}
async function extract(target: URL): Promise<F | null> {
  const id = target.hash.slice(1).split("&")[0];
  if (!id) return null;
  const apis = [
    `${target.origin}/api/v1/video?id=${id}&w=1920&h=1080&r=${encodeURIComponent("toonstream.us")}`,
    `${target.origin}/api/v1/video?id=${id}`,
  ];
  for (const api of apis) {
    try {
      const raw = await text(api, target.href);
      try {
        const d = JSON.parse(raw);
        const f = find(JSON.stringify(d).replaceAll("\\/", "/"));
        if (f) return f;
        const u = d?.url || d?.source || d?.file || d?.src || d?.sources?.[0]?.file;
        if (typeof u === "string" && u.startsWith("http"))
          return { url: u, kind: u.includes(".m3u8") ? "hls" : "mp4" };
      } catch {
        const f = find(raw);
        if (f) return f;
      }
    } catch {
      /* next API */
    }
  }
  return null;
}
export const Route = createFileRoute("/api/extract")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams,
          raw = q.get("url") || "",
          json = q.get("format") === "json";
        let target: URL;
        try {
          target = new URL(raw);
        } catch {
          return Response.json({ ok: false, error: "valid url param required" }, { status: 400 });
        }
        if (target.protocol !== "https:" || !allowed.some((r) => r.test(target.hostname)))
          return Response.json({ ok: false, error: "host not allowed" }, { status: 403 });
        const hit = cache.get(target.href);
        if (hit && hit.expiresAt > Date.now())
          return json
            ? Response.json({ ok: true, cached: true, streamUrl: hit.url, kind: hit.kind })
            : new Response(null, { status: 302, headers: { Location: hit.url } });
        try {
          const f = await extract(target);
          if (!f)
            return Response.json(
              { ok: false, error: "no stream found in embed page" },
              { status: 404 },
            );
          cache.set(target.href, { ...f, expiresAt: Date.now() + 18e5 });
          return json
            ? Response.json({ ok: true, cached: false, streamUrl: f.url, kind: f.kind })
            : new Response(null, { status: 302, headers: { Location: f.url } });
        } catch (e) {
          return Response.json(
            { ok: false, error: `extract failed: ${e instanceof Error ? e.message : String(e)}` },
            { status: 502 },
          );
        }
      },
    },
  },
});
