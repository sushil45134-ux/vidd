import { createFileRoute } from "@tanstack/react-router";
import {
  buildMovieboxPlayerPageUrl,
  isMovieboxDetailPath,
  isMovieboxSubjectId,
  manifestUrlFromSignCookie,
  movieboxClientToken,
  parseMovieboxInput,
  type MovieboxSource,
} from "../../lib/moviebox";

/**
 * /api/moviebox — MovieBox (m2box.org) stream resolver, server-side
 * ====================================================================
 * MovieBox ka koi iframe embed nahi hota. Web player khud ek private JSON
 * API bolta hai (`h5-api.aoneroom.com/wefeed-h5api-bff`) — ye route wahi
 * API server-side bolta hai aur direct MP4/HLS nikaal kar hamare apne
 * player ko deta hai. Poora research: `docs/MOVIEBOX_EMBED.md`.
 *
 * Flow (GitHub ke har working Moviebox-API project ka yahi flow hai):
 *   1. GET  /detail?detailPath=<slug>            → subjectId, seasons, dubs
 *        (sirf subjectId ho to /detail?subjectId=<id> bhi chalta hai)
 *   2. GET  /media-player/get-domain             → rotating player domain
 *        (e.g. https://mzfi.me/ — hardcoded domain kabhi mat rakho)
 *   3. GET  {domain}/wefeed-h5api-bff/subject/play?subjectId=&se=&ep=&detailPath=
 *        Referer: {domain}/spa/videoPlayPage/movies/<slug>?id=…  ← Zaroori!
 *        Bina sahi Referer ke upstream khali `hasResource:false` deta hai
 *        (live verify kiya hai). Fallback: h5-api direct, phir
 *        /subject/download site-proxy se (wahan 1080p vipLocked aata hai).
 *   4. Sources ke signed MP4 CDN se aate hain, jo bina Referer ke 429 deta
 *      hai aur CORS bhi nahi bhejta — isliye har source ke saath ready
 *      `/api/media-proxy?…&referer=…` URL return hota hai.
 *
 * Usage:
 *   /api/moviebox?url=<encoded m2box/moviebox link>[&se=1&ep=2][&res=720]
 *   /api/moviebox?subjectId=<id>&detailPath=<slug>&se=1&ep=2   (kisi ek id se bhi chalega — dusra detail se mil jata hai)
 *   /api/moviebox?detailPath=<slug>                            (movie: se/ep khud 0/0)
 *     → { ok, streamUrl (EmbedPlayer-ready proxy URL), kind, sources[…], … }
 *   &format=play            → best source ke media-proxy par 302 (seedha <video>/VLC)
 *   &mode=detail            → sirf metadata + seasons + dubs (play call nahi)
 *   &mode=captions          → subtitle tracks (pehle play resolve hota hai)
 *   &mode=search&q=<naam>   → catalogue search (detailPath/subjectId ki list)
 *   &debug=1                → har upstream attempt ki trace
 *
 * Dhyan: /subject/play IP-rate-limited hai (~1 success / 2-3 min per IP
 * community reports). Isliye success 20 min aur failure 60s cache hota hai.
 * Signed CDN URLs ghanton me expire hote hain — DB me sirf YE resolver URL
 * save karo, MP4 URL kabhi nahi.
 */

const H5_API = "https://h5-api.aoneroom.com/wefeed-h5api-bff";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** `?host=` param / token mint ke liye default frontend host (env se badal sakte ho). */
const FRONT_HOST = (typeof process !== "undefined" && process.env?.MOVIEBOX_HOST) || "moviebox.ph";
/** /subject/download fallback kin site-proxies se try hoga (sab ek backend). */
const SITE_PROXIES = ["https://movieboxonline.net", "https://m2box.org", "https://moviebox.ph"];
const UPSTREAM_TIMEOUT_MS = 15000;
const DOMAIN_TTL_MS = 5 * 60 * 1000;
const RESOLVE_TTL_MS = 20 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

interface Attempt {
  via: string;
  host: string;
  path: string;
  status?: number;
  note?: string;
  error?: string;
}

export interface MovieboxDub {
  subjectId: string;
  detailPath: string;
  lanName: string;
  lanCode: string;
  original: boolean;
  /** 0 = dub (alag audio), 1 = subtitle-language variant. */
  type: number;
}

export interface MovieboxDetail {
  subjectId: string;
  detailPath: string;
  /** 1 = movie, 2 = TV series, baaki upstream ke dusre type. */
  subjectType: number;
  type: "movie" | "tv" | "other";
  title: string;
  overview: string;
  poster: string;
  backdrop: string;
  year?: number;
  releaseDate: string;
  genre: string[];
  rating: string;
  country: string;
  subtitles: string;
  hasResource: boolean;
  trailer: string;
  cast: { name: string; character: string; avatar: string }[];
  dubs: MovieboxDub[];
  seasons: { season: number; maxEp: number; resolutions: number[] }[];
}

type UpstreamJson = Record<string, unknown> | null;

const domainCache: { value: string; expires: number } = { value: "", expires: 0 };
const tokenCache = new Map<string, { token: string; at: number }>();
const resolveCache = new Map<
  string,
  { payload: Record<string, unknown>; expires: number; ok: boolean }
>();

function defaultHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": UA,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Client-Info": '{"timezone":"Asia/Kolkata"}',
    "X-Request-Lang": "en",
    Referer: `https://${FRONT_HOST}/`,
    Origin: `https://${FRONT_HOST}`,
    ...extra,
  };
}

async function fetchJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; data: UpstreamJson; headers: Headers }> {
  const res = await fetch(url, {
    method: init.method || "GET",
    headers: init.headers,
    body: init.body,
    redirect: "follow",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => "");
  let data: UpstreamJson = null;
  try {
    data = text ? (JSON.parse(text) as UpstreamJson) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : Number.isFinite(n) ? 0 : null;
}

function resolutionOf(entry: Record<string, unknown>): number | null {
  const raw = entry.resolutions ?? entry.resolution;
  if (Array.isArray(raw)) {
    const nums = raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    return nums.length ? Math.max(...nums) : null;
  }
  const n = Number(String(raw ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Anonymous guest JWT — bilkul waise jaise MovieBox ki site khud leti hai:
 * `/home` (ya koi bhi BFF call) ke response ka `x-user` header token deta
 * hai. Bearer ke roop me wapas bhejo to search jaise endpoints khul jate
 * hain. Fail ho to khali return — kai endpoints (detail/trending) bina
 * token ke bhi chalte hain.
 */
async function getBearerToken(host: string): Promise<string> {
  const cached = tokenCache.get(host);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.token;
  try {
    const { headers } = await fetchJson(`${H5_API}/home?host=${encodeURIComponent(host)}`, {
      headers: defaultHeaders(),
    });
    let token = "";
    const xUser = headers.get("x-user");
    if (xUser) {
      try {
        token = str(asRecord(JSON.parse(xUser)).token);
      } catch {
        token = "";
      }
    }
    if (!token) {
      const m = (headers.get("set-cookie") || "").match(/token=([^;]+)/);
      if (m) token = m[1];
    }
    if (token) tokenCache.set(host, { token, at: Date.now() });
    return token;
  } catch {
    return "";
  }
}

/** Rotating player domain (kabhi hardcode mat karo — hafton me badalta hai). */
async function getPlayerDomain(attempts: Attempt[], force = false): Promise<string> {
  if (!force && domainCache.value && Date.now() < domainCache.expires) return domainCache.value;
  const at: Attempt = {
    via: "get-domain",
    host: "h5-api.aoneroom.com",
    path: "/media-player/get-domain",
  };
  attempts.push(at);
  try {
    const { status, data } = await fetchJson(`${H5_API}/media-player/get-domain`, {
      headers: defaultHeaders(),
    });
    at.status = status;
    const domain = str(asRecord(data).data).replace(/\/+$/, "");
    if (status === 200 && /^https?:\/\//i.test(domain)) {
      domainCache.value = domain;
      domainCache.expires = Date.now() + DOMAIN_TTL_MS;
      at.note = domain;
      return domain;
    }
    at.note = "khali domain, fallback";
  } catch (e) {
    at.error = errText(e);
  }
  return "https://netfilm.world";
}

function normalizeDetail(data: UpstreamJson): MovieboxDetail | null {
  const inner = asRecord(asRecord(data).data);
  const subject = asRecord(inner.subject);
  const subjectId = str(subject.subjectId);
  const detailPath = str(subject.detailPath);
  if (!subjectId && !detailPath) return null;
  const subjectType = Number(subject.subjectType) || 0;
  const cover = asRecord(subject.cover);
  const stills = asRecord(subject.stills);
  const trailer = asRecord(asRecord(subject.trailer).videoAddress);
  const releaseDate = str(subject.releaseDate);
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) || undefined : undefined;
  const resource = asRecord(inner.resource);
  return {
    subjectId,
    detailPath,
    subjectType,
    type: subjectType === 1 ? "movie" : subjectType === 2 ? "tv" : "other",
    title: str(subject.title),
    overview: str(subject.description),
    poster: str(cover.url),
    backdrop: str(stills.url),
    year,
    releaseDate,
    genre: str(subject.genre)
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    rating: str(subject.imdbRatingValue),
    country: str(subject.countryName),
    subtitles: str(subject.subtitles),
    hasResource: subject.hasResource === true,
    trailer: str(trailer.url),
    cast: asArray(inner.stars)
      .slice(0, 20)
      .map((s) => ({ name: str(s.name), character: str(s.character), avatar: str(s.avatarUrl) })),
    dubs: asArray(subject.dubs).map((d) => ({
      subjectId: str(d.subjectId),
      detailPath: str(d.detailPath),
      lanName: str(d.lanName),
      lanCode: str(d.lanCode),
      original: d.original === true,
      type: Number(d.type) || 0,
    })),
    seasons: asArray(resource.seasons).map((s) => ({
      season: Number(s.se) || 0,
      maxEp: Number(s.maxEp) || 0,
      resolutions: asArray(s.resolutions)
        .map((r) => Number(r.resolution))
        .filter((n) => Number.isFinite(n) && n > 0),
    })),
  };
}

/** detailPath se detail; sirf subjectId ho to wo bhi chalta hai (live verify). */
async function fetchDetail(
  ref: { subjectId?: string; detailPath?: string },
  attempts: Attempt[],
): Promise<MovieboxDetail | null> {
  const queries: string[] = [];
  if (ref.detailPath) queries.push(`detailPath=${encodeURIComponent(ref.detailPath)}`);
  if (ref.subjectId) queries.push(`subjectId=${encodeURIComponent(ref.subjectId)}`);
  if (!queries.length) return null;

  const token = await getBearerToken(FRONT_HOST);
  for (const q of queries) {
    const at: Attempt = {
      via: "detail",
      host: "h5-api.aoneroom.com",
      path: `/detail?${q.split("=")[0]}=…`,
    };
    attempts.push(at);
    try {
      const headers = defaultHeaders(token ? { Authorization: `Bearer ${token}` } : {});
      const first = await fetchJson(`${H5_API}/detail?${q}`, { headers });
      at.status = first.status;
      const detail = first.status === 200 ? normalizeDetail(first.data) : null;
      if (detail) return detail;
      // Kuch regions me `host=` param ke bina detail khali aata hai.
      const second = await fetchJson(
        `${H5_API}/detail?${q}&host=${encodeURIComponent(FRONT_HOST)}`,
        {
          headers,
        },
      );
      at.status = second.status;
      const detail2 = second.status === 200 ? normalizeDetail(second.data) : null;
      if (detail2) return detail2;
      at.note = "subject nahi mila";
    } catch (e) {
      at.error = errText(e);
    }
  }
  return null;
}

function kindOf(entry: Record<string, unknown>, bucket: string): MovieboxSource["kind"] {
  const format = str(entry.format).toUpperCase();
  const url = str(entry.url);
  if (bucket === "hls" || format === "HLS" || /\.m3u8(\?|$)/i.test(url)) return "hls";
  if (bucket === "dash" || format === "DASH" || /\.mpd(\?|$)/i.test(url)) return "dash";
  return "mp4";
}

function toSource(
  entry: Record<string, unknown>,
  bucket: string,
  ctx: { requestUrl: URL; referer: string; origin: string },
): MovieboxSource | null {
  const kind = kindOf(entry, bucket);
  const signCookie = str(entry.signCookie);
  const rawUrl = str(entry.url);
  // Mobile-style dummy `url` ka ilaaj: signCookie ke urlprefix se asli manifest.
  const fromCookie =
    kind === "mp4" ? null : manifestUrlFromSignCookie(signCookie, kind === "dash" ? "dash" : "hls");
  const url = rawUrl || fromCookie || "";
  if (!/^https?:\/\//i.test(url)) return null;

  const proxy = new URL("/api/media-proxy", ctx.requestUrl);
  proxy.searchParams.set("u", url);
  proxy.searchParams.set("referer", ctx.referer);
  proxy.searchParams.set("origin", ctx.origin);
  if (signCookie) proxy.searchParams.set("cookie", signCookie);

  return {
    resolution: resolutionOf(entry),
    format: str(entry.format) || (kind === "hls" ? "HLS" : kind === "dash" ? "DASH" : "MP4"),
    kind,
    url,
    proxyUrl: `${proxy.pathname}?${proxy.searchParams.toString()}`,
    size: numOrNull(entry.size),
    duration: numOrNull(entry.duration),
    codec: str(entry.codecName || entry.codec),
    vipLocked: entry.vipLocked === true,
  };
}

interface PlayResult {
  sources: MovieboxSource[];
  /** Captions ke liye chahiye: pehle stream ka id + format (raw upstream). */
  firstStreamId: string;
  firstStreamFormat: string;
  hasResource: boolean;
  limited: boolean;
  via: string;
  referer: string;
}

async function tryPlay(
  playUrl: string,
  headers: Record<string, string>,
  via: string,
  ctx: { requestUrl: URL; referer: string; origin: string },
  attempts: Attempt[],
): Promise<PlayResult | null> {
  const u = new URL(playUrl);
  const at: Attempt = { via, host: u.hostname, path: u.pathname };
  attempts.push(at);
  try {
    const { status, data } = await fetchJson(playUrl, { headers });
    at.status = status;
    if (status !== 200 || !data) {
      at.note = status === 429 ? "rate-limited (429)" : "koi data nahi";
      return null;
    }
    const inner = asRecord(data.data);
    const streams = asArray(inner.streams);
    const downloads = asArray(inner.downloads);
    const dash = asArray(inner.dash);
    const hls = asArray(inner.hls);
    const sources: MovieboxSource[] = [];
    for (const s of streams) {
      const x = toSource(s, "streams", ctx);
      if (x) sources.push(x);
    }
    if (!sources.length) {
      for (const s of downloads) {
        const x = toSource(s, "streams", ctx);
        if (x) sources.push(x);
      }
    }
    for (const s of hls) {
      const x = toSource(s, "hls", ctx);
      if (x) sources.push(x);
    }
    for (const s of dash) {
      const x = toSource(s, "dash", ctx);
      if (x) sources.push(x);
    }
    sources.sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
    at.note = `hasResource=${inner.hasResource === true} sources=${sources.length}`;
    const first = streams[0] || dash[0] || hls[0] || {};
    return {
      sources,
      firstStreamId: str(first.id),
      firstStreamFormat: str(first.format) || "MP4",
      hasResource: inner.hasResource === true,
      limited: inner.limited === true,
      via,
      referer: ctx.referer,
    };
  } catch (e) {
    at.error = errText(e);
    return null;
  }
}

async function resolvePlay(
  detail: MovieboxDetail,
  se: number,
  ep: number,
  requestUrl: URL,
  attempts: Attempt[],
): Promise<PlayResult | null> {
  const { subjectId, detailPath } = detail;
  const qs = `subjectId=${encodeURIComponent(subjectId)}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(detailPath)}`;

  // 1) Player domain se, player-page Referer ke saath (web player khud aisa karta hai).
  const domain = await getPlayerDomain(attempts);
  const playerReferer = buildMovieboxPlayerPageUrl(domain, detailPath, subjectId, se, ep);
  const ctx = { requestUrl, referer: playerReferer, origin: new URL(domain).origin };
  const viaPlayer = await tryPlay(
    `${domain}/wefeed-h5api-bff/subject/play?${qs}`,
    defaultHeaders({
      Referer: playerReferer,
      Origin: ctx.origin,
      "X-Source": "",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    }),
    "play@player-domain",
    ctx,
    attempts,
  );
  if (viaPlayer && viaPlayer.sources.length) return viaPlayer;

  // 2) h5-api direct, ek site ke videoPlayPage Referer ke saath.
  const siteReferer = `${SITE_PROXIES[0]}/videoPlayPage/${encodeURIComponent(detailPath)}?type=/movie/detail`;
  const ctx2 = { requestUrl, referer: siteReferer, origin: SITE_PROXIES[0] };
  const viaH5 = await tryPlay(
    `${H5_API}/subject/play?${qs}`,
    defaultHeaders({ Referer: siteReferer, Origin: SITE_PROXIES[0] }),
    "play@h5-api",
    ctx2,
    attempts,
  );
  if (viaH5 && viaH5.sources.length) return viaH5;

  // 3) /subject/download site-proxy se (bulk me zyada reliable, 1080p vipLocked).
  let vipOnly: PlayResult | null = null;
  for (const site of SITE_PROXIES) {
    const referer = `${site}/videoPlayPage/${encodeURIComponent(detailPath)}?type=/movie/detail`;
    const viaDl = await tryPlay(
      `${site}/wefeed-h5api-bff/subject/download?${qs}`,
      defaultHeaders({ Referer: referer, Origin: site }),
      `download@${new URL(site).hostname}`,
      { requestUrl, referer, origin: site },
      attempts,
    );
    if (viaDl && viaDl.sources.some((s) => !s.vipLocked)) return viaDl;
    // Sirf VIP-locked entries mili — aakhri ummeed ke roop me rakho, aage badho.
    if (viaDl && viaDl.sources.length && !vipOnly) vipOnly = viaDl;
  }
  return viaPlayer || viaH5 || vipOnly;
}

function pickBest(sources: MovieboxSource[], wantRes: number | null): MovieboxSource | null {
  const free = sources.filter((s) => !s.vipLocked);
  const pool = free.length ? free : sources;
  if (!pool.length) return null;
  const playable = pool.filter((s) => s.kind !== "dash");
  const ranked = (playable.length ? playable : pool)
    .slice()
    .sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
  if (wantRes) {
    const exact = ranked.find((s) => s.resolution === wantRes);
    if (exact) return exact;
    const under = ranked.find((s) => (s.resolution || 0) < wantRes);
    if (under) return under;
  }
  return ranked[0] || null;
}

async function searchSubjects(q: string, page: number, attempts: Attempt[]) {
  const at: Attempt = { via: "search", host: "h5-api.aoneroom.com", path: "/subject/search" };
  attempts.push(at);
  // Token: pehle /home wala x-user JWT, warna search-suggest mint
  // (X-Client-Token = sec,md5(reverse(sec)) — suggest ka response x-user deta hai).
  let token = await getBearerToken(FRONT_HOST);
  const doSearch = async (bearer: string) => {
    try {
      const { status, data } = await fetchJson(`${H5_API}/subject/search`, {
        method: "POST",
        headers: defaultHeaders({
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        }),
        // Site ki apni search perPage:0 bhejti hai — yahi order/count site jaisa rakhta hai.
        body: JSON.stringify({ keyword: q, page, perPage: 0, subjectType: 0 }),
      });
      at.status = status;
      return { status, data };
    } catch (e) {
      at.error = errText(e);
      return { status: 0, data: null as UpstreamJson };
    }
  };
  let result = await doSearch(token);
  if (result.status === 401 || result.status === 403 || !result.data) {
    try {
      const mint = await fetchJson(`${H5_API}/subject/search-suggest`, {
        method: "POST",
        headers: defaultHeaders({
          "Content-Type": "application/json",
          Authorization: "",
          "X-Client-Token": movieboxClientToken(),
        }),
        body: JSON.stringify({ keyword: q, perPage: 10 }),
      });
      const xUser = mint.headers.get("x-user");
      if (xUser) {
        token = str(asRecord(JSON.parse(xUser)).token);
        if (token) {
          tokenCache.set(FRONT_HOST, { token, at: Date.now() });
          result = await doSearch(token);
        }
      }
    } catch (e) {
      at.error = errText(e);
    }
  }
  const inner = asRecord(asRecord(result.data).data);
  const items = asArray(inner.items).map((s) => {
    const cover = typeof s.cover === "string" ? s.cover : str(asRecord(s.cover).url);
    return {
      title: str(s.title),
      subjectId: str(s.subjectId || s.id),
      detailPath: str(s.detailPath),
      subjectType: Number(s.subjectType) || 0,
      type: Number(s.subjectType) === 1 ? "movie" : Number(s.subjectType) === 2 ? "tv" : "other",
      poster: cover,
      year: str(s.releaseDate).slice(0, 4) || "",
      rating: str(s.imdbRatingValue),
      hasResource: s.hasResource === true,
      resolverUrl: str(s.detailPath)
        ? `/api/moviebox?detailPath=${encodeURIComponent(str(s.detailPath))}`
        : "",
    };
  });
  const pager = asRecord(inner.pager);
  return {
    query: q,
    page,
    total: Number(pager.totalCount) || items.length,
    hasMore: pager.hasMore === true,
    items,
  };
}

function json(payload: unknown, status = 200, cache = "no-store"): Response {
  return Response.json(payload, { status, headers: { "cache-control": cache } });
}

export const Route = createFileRoute("/api/moviebox")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const params = reqUrl.searchParams;
        const mode = (params.get("mode") || "stream").trim().toLowerCase();
        const wantPlayRedirect = params.get("format") === "play";
        const wantDebug = params.get("debug") === "1";
        const attempts: Attempt[] = [];
        const debug = wantDebug ? { attempts } : {};

        try {
          if (mode === "search") {
            const q = (params.get("q") || params.get("query") || "").trim();
            if (!q) return json({ ok: false, error: "q required — movie/show ka naam do" }, 400);
            if (q.length > 120) return json({ ok: false, error: "q bahut lamba hai" }, 400);
            const page = Math.min(Math.max(parseInt(params.get("page") || "1", 10) || 1, 1), 50);
            const out = await searchSubjects(q, page, attempts);
            return json({ ok: true, mode, ...out, ...debug }, 200, "public, max-age=120");
          }

          // Input: pura link, ya subjectId/detailPath alag-alag.
          const rawInput = (params.get("url") || params.get("q") || "").trim();
          const fromLink = rawInput ? parseMovieboxInput(rawInput) : null;
          if (rawInput && !fromLink) {
            return json(
              {
                ok: false,
                error:
                  "Ye link MovieBox ka nahi laga. m2box/moviebox ki watch link do, " +
                  "e.g. https://m2box.org/movies/<slug>?id=<subjectId>&type=/movie/detail",
                ...debug,
              },
              400,
            );
          }
          const ref = {
            subjectId:
              (isMovieboxSubjectId(params.get("subjectId")) ? str(params.get("subjectId")) : "") ||
              fromLink?.subjectId ||
              undefined,
            detailPath:
              (isMovieboxDetailPath(params.get("detailPath"))
                ? str(params.get("detailPath"))
                : "") ||
              fromLink?.detailPath ||
              undefined,
          };
          if (!ref.subjectId && !ref.detailPath) {
            return json(
              {
                ok: false,
                error:
                  "url (m2box link), detailPath (slug) ya subjectId — kam se kam ek chahiye. " +
                  "Naam se dhundhna hai to ?mode=search&q=<naam> use karo.",
                ...debug,
              },
              400,
            );
          }

          const detail = await fetchDetail(ref, attempts);
          if (!detail || (!detail.subjectId && !detail.detailPath)) {
            return json(
              {
                ok: false,
                error:
                  "MovieBox par ye title nahi mila (detail khali). detailPath/subjectId " +
                  "dobara check karo — slug link ke path me aur id `?id=` me hota hai.",
                ...debug,
              },
              404,
            );
          }

          if (mode === "detail") {
            return json(
              {
                ok: true,
                mode,
                ...detail,
                resolverUrl: `/api/moviebox?subjectId=${detail.subjectId}&detailPath=${encodeURIComponent(detail.detailPath)}`,
                ...debug,
              },
              200,
              "public, max-age=300",
            );
          }

          // se/ep: query > link ka detailSe/detailEp > type ke hisaab se default.
          const wantResRaw = parseInt(params.get("res") || params.get("resolution") || "", 10);
          const wantRes = Number.isFinite(wantResRaw) && wantResRaw > 0 ? wantResRaw : null;
          const isTv = detail.type === "tv";
          let se = parseInt(params.get("se") || params.get("season") || "", 10);
          let ep = parseInt(params.get("ep") || params.get("episode") || "", 10);
          if (!Number.isInteger(se)) se = fromLink?.se ?? (isTv ? 1 : 0);
          if (!Number.isInteger(ep)) ep = fromLink?.ep ?? (isTv ? 1 : 0);
          if (isTv) {
            if (se <= 0) se = 1;
            if (ep <= 0) ep = 1;
          } else {
            // Movie par se/ep galti se 1/1 aaya ho to 0/0 hi sahi rehta hai;
            // pehle diye hue se koshish hogi, khali aaye to neeche 0/0 retry.
            if (se < 0) se = 0;
            if (ep < 0) ep = 0;
          }

          const cacheKey = `${detail.subjectId}|${se}|${ep}|${mode}|${wantRes || "best"}`;
          const cached = resolveCache.get(cacheKey);
          if (cached && Date.now() < cached.expires) {
            if (wantPlayRedirect && cached.ok) {
              const streamUrl = str(cached.payload.streamUrl);
              if (streamUrl) {
                return new Response(null, {
                  status: 302,
                  headers: {
                    Location: new URL(streamUrl, reqUrl).href,
                    "cache-control": "no-store",
                  },
                });
              }
            }
            return json({ ...cached.payload, cached: true, ...debug }, cached.ok ? 200 : 502);
          }

          let play = await resolvePlay(detail, se, ep, reqUrl, attempts);
          if (!isTv && (!play || !play.sources.length) && (se !== 0 || ep !== 0)) {
            const asMovie = await resolvePlay(detail, 0, 0, reqUrl, attempts);
            if (asMovie && asMovie.sources.length) {
              play = asMovie;
              se = 0;
              ep = 0;
            }
          }

          if (!play || !play.sources.length) {
            const payload = {
              ok: false,
              error:
                "Is episode/movie ki koi stream nahi mili. Aam wajah: (1) /subject/play " +
                "IP-rate-limit (~2-3 min ruk kar retry karo), (2) ye episode MovieBox par " +
                "hai hi nahi, (3) guest ke liye region/quality lock. &debug=1 se har " +
                "attempt dikhega.",
              subjectId: detail.subjectId,
              detailPath: detail.detailPath,
              title: detail.title,
              type: detail.type,
              se,
              ep,
              hasResource: play?.hasResource ?? detail.hasResource,
              seasons: detail.seasons,
              dubs: detail.dubs,
            };
            resolveCache.set(cacheKey, {
              payload,
              expires: Date.now() + NEGATIVE_TTL_MS,
              ok: false,
            });
            return json({ ...payload, ...debug }, 502);
          }

          if (mode === "captions") {
            let captions: Record<string, unknown>[] = [];
            if (play.firstStreamId) {
              const token = await getBearerToken(FRONT_HOST);
              const capAt: Attempt = {
                via: "captions",
                host: "h5-api.aoneroom.com",
                path: "/subject/caption",
              };
              attempts.push(capAt);
              try {
                const capUrl =
                  `${H5_API}/subject/caption?format=${encodeURIComponent(play.firstStreamFormat)}` +
                  `&id=${encodeURIComponent(play.firstStreamId)}&subjectId=${encodeURIComponent(detail.subjectId)}` +
                  `&detailPath=${encodeURIComponent(detail.detailPath)}`;
                const { status, data } = await fetchJson(capUrl, {
                  headers: defaultHeaders(token ? { Authorization: `Bearer ${token}` } : {}),
                });
                capAt.status = status;
                const inner = asRecord(asRecord(data).data);
                captions = asArray(inner.captions).map((c) => ({
                  lang: str(c.lan || c.lang || c.language),
                  label: str(c.lanName || c.name || c.lan),
                  url: str(c.url),
                }));
              } catch (e) {
                capAt.error = errText(e);
              }
            }
            return json({
              ok: true,
              mode,
              subjectId: detail.subjectId,
              detailPath: detail.detailPath,
              se,
              ep,
              count: captions.length,
              captions,
              ...debug,
            });
          }

          const best = pickBest(play.sources, wantRes);
          const payload: Record<string, unknown> = {
            ok: true,
            mode: "stream",
            title: detail.title,
            subjectId: detail.subjectId,
            detailPath: detail.detailPath,
            subjectType: detail.subjectType,
            type: detail.type,
            se,
            ep,
            via: play.via,
            hasResource: play.hasResource,
            limited: play.limited,
            /** EmbedPlayer seedha yahi uthata hai (`/api/extract` jaisa shape). */
            streamUrl: best ? best.proxyUrl : "",
            /** Proxy-bina wala signed URL (VLC/mpv/debug ke liye; Referer lagega). */
            directUrl: best ? best.url : "",
            kind: best ? best.kind : "mp4",
            sources: play.sources,
            referer: play.referer,
            captionsUrl: `/api/moviebox?mode=captions&subjectId=${detail.subjectId}&detailPath=${encodeURIComponent(detail.detailPath)}&se=${se}&ep=${ep}`,
            seasons: detail.seasons,
            dubs: detail.dubs,
            note:
              "streamUrl/directUrl signed hain — kuch ghanton me expire hote hain. " +
              "DB me hamesha ye /api/moviebox resolver URL save karo, MP4 URL nahi.",
          };
          resolveCache.set(cacheKey, { payload, expires: Date.now() + RESOLVE_TTL_MS, ok: true });

          if (wantPlayRedirect && best) {
            return new Response(null, {
              status: 302,
              headers: {
                Location: new URL(best.proxyUrl, reqUrl).href,
                "cache-control": "no-store",
              },
            });
          }
          return json({ ...payload, ...debug });
        } catch (err) {
          console.error("[moviebox] error", err);
          return json(
            { ok: false, error: errText(err) || "MovieBox resolve fail ho gaya", ...debug },
            500,
          );
        }
      },
    },
  },
});
