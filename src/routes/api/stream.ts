import { createFileRoute } from "@tanstack/react-router";
const HOSTS = ["https://net27.cc", "https://net22.cc", "https://net77.cc", "https://net79.cc"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
type S = { url?: string; resolution?: number | string };
type D = {
  ok?: boolean;
  title?: string;
  year?: string;
  resolution?: number | string;
  mp4?: string;
  streams?: S[];
  cdn?: string;
  exp?: number;
  error?: string;
};
type C = { url: string; expiresAt: number; meta: Record<string, unknown> };
const cache = new Map<string, C>();
const best = (d: D) =>
  d.streams
    ?.filter((s) => typeof s.url === "string" && s.url.startsWith("http"))
    .sort((a, b) => Number(b.resolution || 0) - Number(a.resolution || 0))[0]?.url ||
  d.mp4 ||
  "";
async function resolve(path: string) {
  let err = "no upstream";
  for (const base of [process.env.NETMIRROR_BASE, ...HOSTS].filter(Boolean)) {
    try {
      const r = await fetch(`${base}${path}`, {
        headers: {
          "User-Agent": UA,
          Referer: "https://videodownloader.site/",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        err = `${base} HTTP ${r.status}`;
        continue;
      }
      const d = (await r.json()) as D;
      if (d.ok && best(d)) return { d, base };
      err = `${base} ${d.error || "no stream"}`;
    } catch (e) {
      err = String(e);
    }
  }
  return { failure: err };
}
export const Route = createFileRoute("/api/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams,
          tmdb = q.get("tmdb") || "";
        if (!/^\d{1,10}$/.test(tmdb))
          return Response.json({ ok: false, error: "tmdb (numeric) required" }, { status: 400 });
        const tv = q.get("type") === "tv",
          path = tv
            ? `/api/embed-tmdb/${tmdb}?type=tv&s=${q.get("s") || "1"}&e=${q.get("e") || "1"}`
            : `/api/embed-tmdb/${tmdb}`,
          json = q.get("format") === "json",
          proxy = q.get("via") === "proxy",
          final = (u: string) =>
            proxy ? `https://net27.cc/api/proxy/video?url=${encodeURIComponent(u)}` : u,
          hit = cache.get(path);
        if (hit && hit.expiresAt > Date.now())
          return json
            ? Response.json({ ok: true, cached: true, streamUrl: final(hit.url), ...hit.meta })
            : new Response(null, { status: 302, headers: { Location: final(hit.url) } });
        const x = await resolve(path);
        if ("failure" in x) return Response.json({ ok: false, error: x.failure }, { status: 502 });
        const u = best(x.d),
          meta = {
            title: x.d.title || "",
            year: x.d.year || "",
            resolution: x.d.resolution || "",
            cdn: x.d.cdn || "",
            upstream: x.base,
          };
        const exp = Number(x.d.exp) * 1000;
        cache.set(path, {
          url: u,
          meta,
          expiresAt: Math.min(exp > Date.now() ? exp - 9e5 : Date.now() + 18e5, Date.now() + 72e5),
        });
        return json
          ? Response.json({ ok: true, cached: false, streamUrl: final(u), ...meta })
          : new Response(null, { status: 302, headers: { Location: final(u) } });
      },
    },
  },
});
