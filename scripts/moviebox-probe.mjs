#!/usr/bin/env node
/**
 * MovieBox Probe — m2box/moviebox link se direct MP4/HLS nikaalo (standalone)
 * ===========================================================================
 * MovieBox ka koi iframe embed nahi hota. Ye script wahi karta hai jo web
 * player khud karta hai — MovieBox ki H5 API ko bilkul usi ke headers ke
 * saath call karta hai:
 *
 *   1. GET h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath=<slug>
 *   2. GET …/media-player/get-domain            (rotating player domain)
 *   3. GET {domain}/wefeed-h5api-bff/subject/play?subjectId=&se=&ep=&detailPath=
 *      Referer: {domain}/spa/videoPlayPage/movies/<slug>?id=…   ← Ye header
 *      na ho to upstream khali hasResource:false deta hai. (Live verify hai.)
 *
 * Koi npm dependency nahi (Node 18+). Server wala hissa `src/routes/api/
 * moviebox.ts` me hai; ye script repo ke bahar, apne PC/VPS par akele
 * chalne ke liye hai (parse logic `src/lib/moviebox.ts` se mirror ki hai).
 *
 * Usage:
 *   node scripts/moviebox-probe.mjs "<m2box link>" [season] [episode]
 *   node scripts/moviebox-probe.mjs my-demon-hindi-SfaaEeePcfa 1 3
 *   node scripts/moviebox-probe.mjs --detail my-demon-hindi-SfaaEeePcfa
 *   node scripts/moviebox-probe.mjs --search "My Demon Hindi"
 *   node scripts/moviebox-probe.mjs "<link>" 1 1 --json
 *
 * Example:
 *   node scripts/moviebox-probe.mjs "https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail" 1 1
 *
 * Dhyan:
 *   - /subject/play IP-rate-limited hai (~1 success / 2-3 min per IP).
 *     Khali aaye to thoda ruk kar dobara chalao.
 *   - Mile hue MP4 URLs signed hote hain, ghanton me expire ho jate hain,
 *     aur CDN bina Referer ke 429 deta hai — script ready-made
 *     curl/mpv/ffmpeg commands bhi print karta hai.
 *   - Website me permanent lagana hai to MP4 mat lagao; Vidd ka
 *     `/api/moviebox?…` resolver URL lagao (docs/MOVIEBOX_EMBED.md).
 */
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const H5_API = "https://h5-api.aoneroom.com/wefeed-h5api-bff";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SITE_PROXIES = ["https://movieboxonline.net", "https://m2box.org", "https://moviebox.ph"];

/** H5 search-suggest ka guest token: `<unix-sec>,<md5(reverse(sec))>`. */
export function clientToken(nowMs = Date.now()) {
  const sec = String(Math.floor(nowMs / 1000));
  const hash = crypto.createHash("md5").update(sec.split("").reverse().join("")).digest("hex");
  return `${sec},${hash}`;
}

/** m2box/moviebox link (ya bare slug/id) → { subjectId, detailPath, se, ep }. */
export function parseMovieboxUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^\d{5,25}$/.test(raw)) return { subjectId: raw, raw };
  if (/^[A-Za-z0-9][A-Za-z0-9-]{2,160}$/.test(raw) && raw.includes("-")) {
    return { detailPath: raw, raw };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  let last = segments.length ? segments[segments.length - 1] : "";
  try {
    last = decodeURIComponent(last);
  } catch {
    // raw segment hi rakho
  }
  const ref = { host: url.hostname.toLowerCase(), raw };
  const id = url.searchParams.get("id") || url.searchParams.get("subjectId");
  if (id && /^\d{5,25}$/.test(id)) ref.subjectId = id;
  const dp = url.searchParams.get("detailPath");
  if (dp && /^[A-Za-z0-9][A-Za-z0-9-]{2,160}$/.test(dp)) ref.detailPath = dp;
  else if (/^[A-Za-z0-9][A-Za-z0-9-]{2,160}$/.test(last) && last.includes("-")) ref.detailPath = last;
  const se = url.searchParams.get("detailSe") ?? url.searchParams.get("se");
  const ep = url.searchParams.get("detailEp") ?? url.searchParams.get("ep");
  if (se !== null && se !== "" && Number.isInteger(Number(se))) ref.se = Number(se);
  if (ep !== null && ep !== "" && Number.isInteger(Number(ep))) ref.ep = Number(ep);
  return ref.subjectId || ref.detailPath ? ref : null;
}

/** signCookie ke `urlprefix=` se asli manifest banao (mobile dummy-url ilaaj). */
export function manifestUrlFromSignCookie(signCookie, kind) {
  const rawText = String(signCookie || "");
  if (!rawText) return null;
  for (const text of [rawText, safeDecode(rawText)]) {
    const m = text.match(/urlprefix=([^&;]+)/i);
    if (!m?.[1]) continue;
    const prefix = safeDecode(m[1].trim());
    if (!/^https?:\/\//i.test(prefix)) continue;
    const file = kind === "dash" ? "index.mpd" : "index.m3u8";
    return prefix.endsWith(file) ? prefix : `${prefix.replace(/\/?$/, "/")}${file}`;
  }
  return null;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function headers(extra = {}) {
  return {
    "User-Agent": UA,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Client-Info": '{"timezone":"Asia/Kolkata"}',
    "X-Request-Lang": "en",
    Referer: "https://moviebox.ph/",
    Origin: "https://moviebox.ph",
    ...extra,
  };
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), ...init });
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

let bearerToken = "";
async function ensureToken() {
  if (bearerToken) return bearerToken;
  try {
    const { headers: h } = await fetchJson(`${H5_API}/home?host=moviebox.ph`, { headers: headers() });
    const x = h.get("x-user");
    if (x) bearerToken = JSON.parse(x).token || "";
  } catch {
    // detail/trending bina token ke bhi chalte hain
  }
  return bearerToken;
}

async function getDetail(ref) {
  const token = await ensureToken();
  const qs = ref.detailPath
    ? `detailPath=${encodeURIComponent(ref.detailPath)}`
    : `subjectId=${encodeURIComponent(ref.subjectId)}`;
  for (const suffix of ["", "&host=moviebox.ph"]) {
    const { status, data } = await fetchJson(`${H5_API}/detail?${qs}${suffix}`, {
      headers: headers(token ? { Authorization: `Bearer ${token}` } : {}),
    });
    const subject = data?.data?.subject;
    if (status === 200 && subject) return { subject, resource: data.data.resource || {}, raw: data.data };
  }
  return null;
}

async function getPlayerDomain() {
  try {
    const { status, data } = await fetchJson(`${H5_API}/media-player/get-domain`, {
      headers: headers(),
    });
    const domain = String(data?.data || "").replace(/\/+$/, "");
    if (status === 200 && /^https?:\/\//.test(domain)) return domain;
  } catch {
    // fallback neeche
  }
  return "https://netfilm.world";
}

export function normalizeStreams(inner) {
  const out = [];
  const push = (list, bucket) => {
    for (const s of list || []) {
      const kind =
        bucket === "hls" || String(s.format || "").toUpperCase() === "HLS" || /\.m3u8(\?|$)/i.test(s.url || "")
          ? "hls"
          : bucket === "dash" || String(s.format || "").toUpperCase() === "DASH" || /\.mpd(\?|$)/i.test(s.url || "")
            ? "dash"
            : "mp4";
      const url =
        s.url ||
        (kind !== "mp4" ? manifestUrlFromSignCookie(s.signCookie, kind === "dash" ? "dash" : "hls") : "") ||
        "";
      if (!url) continue;
      const resRaw = Array.isArray(s.resolutions) ? Math.max(...s.resolutions.map(Number)) : s.resolutions ?? s.resolution;
      out.push({
        resolution: Number(String(resRaw ?? "").replace(/[^\d]/g, "")) || null,
        format: s.format || kind.toUpperCase(),
        kind,
        codec: s.codecName || s.codec || "",
        sizeMB: s.size ? Math.round((Number(s.size) / 1e6) * 100) / 100 : null,
        duration: s.duration || null,
        vipLocked: !!s.vipLocked,
        signCookie: s.signCookie || "",
        url,
      });
    }
  };
  push(inner?.streams, "streams");
  if (!out.length) push(inner?.downloads, "streams");
  push(inner?.hls, "hls");
  push(inner?.dash, "dash");
  return out.sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
}

async function tryPlay(url, hdrs, via) {
  try {
    const { status, data } = await fetchJson(url, { headers: hdrs });
    const inner = data?.data || {};
    const sources = status === 200 ? normalizeStreams(inner) : [];
    console.error(`[probe] ${via} → HTTP ${status}, hasResource=${!!inner.hasResource}, sources=${sources.length}`);
    return sources.length ? { via, sources, inner } : null;
  } catch (e) {
    console.error(`[probe] ${via} → ${e.message}`);
    return null;
  }
}

async function resolveStreams({ subjectId, detailPath, se, ep }) {
  const qs = `subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(detailPath)}`;
  const domain = await getPlayerDomain();
  const playerReferer =
    `${domain}/spa/videoPlayPage/movies/${encodeURIComponent(detailPath)}` +
    `?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
  console.error(`[probe] player domain: ${domain}`);

  const attempts = [
    () =>
      tryPlay(
        `${domain}/wefeed-h5api-bff/subject/play?${qs}`,
        headers({ Referer: playerReferer, Origin: new URL(domain).origin, "X-Source": "" }),
        "play@player-domain",
      ).then((r) => (r ? { ...r, referer: playerReferer } : r)),
    () =>
      tryPlay(
        `${H5_API}/subject/play?${qs}`,
        headers({ Referer: `${SITE_PROXIES[0]}/videoPlayPage/${detailPath}?type=/movie/detail`, Origin: SITE_PROXIES[0] }),
        "play@h5-api",
      ).then((r) =>
        r ? { ...r, referer: `${SITE_PROXIES[0]}/videoPlayPage/${detailPath}?type=/movie/detail` } : r,
      ),
    ...SITE_PROXIES.map(
      (site) => () =>
        tryPlay(
          `${site}/wefeed-h5api-bff/subject/download?${qs}`,
          headers({ Referer: `${site}/videoPlayPage/${detailPath}?type=/movie/detail`, Origin: site }),
          `download@${new URL(site).hostname}`,
        ).then((r) =>
          r ? { ...r, referer: `${site}/videoPlayPage/${detailPath}?type=/movie/detail` } : r,
        ),
    ),
  ];
  for (const attempt of attempts) {
    const r = await attempt();
    if (r && r.sources.some((s) => !s.vipLocked)) return r;
  }
  return null;
}

async function search(q, page = 1) {
  let token = await ensureToken();
  const doSearch = (bearer) =>
    fetchJson(`${H5_API}/subject/search`, {
      method: "POST",
      headers: headers({
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      }),
      body: JSON.stringify({ keyword: q, page, perPage: 0, subjectType: 0 }),
    });
  let r = await doSearch(token);
  if (r.status === 401 || r.status === 403 || !r.data) {
    const mint = await fetchJson(`${H5_API}/subject/search-suggest`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json", Authorization: "", "X-Client-Token": clientToken() }),
      body: JSON.stringify({ keyword: q, perPage: 10 }),
    });
    const x = mint.headers.get("x-user");
    if (x) {
      token = JSON.parse(x).token || "";
      if (token) r = await doSearch(token);
    }
  }
  return (r.data?.data?.items || []).map((s) => ({
    title: s.title,
    subjectId: String(s.subjectId || ""),
    detailPath: s.detailPath || "",
    type: s.subjectType === 1 ? "movie" : s.subjectType === 2 ? "tv" : "other",
    rating: s.imdbRatingValue || "",
  }));
}

async function main(argv) {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));

  if (args[0] === "--search") {
    const q = positional.join(" ");
    if (!q) throw new Error('Usage: node scripts/moviebox-probe.mjs --search "My Demon Hindi"');
    const items = await search(q);
    if (asJson) console.log(JSON.stringify(items, null, 2));
    else {
      for (const i of items) {
        console.log(`${i.title}  [${i.type}] ${i.rating ? `★${i.rating}  ` : ""}subjectId=${i.subjectId}  detailPath=${i.detailPath}`);
      }
      console.log(`\nStream ke liye: node scripts/moviebox-probe.mjs <detailPath> [season] [episode]`);
    }
    return;
  }

  const input = positional[0];
  if (!input) {
    console.error(
      'Usage:\n  node scripts/moviebox-probe.mjs "<m2box link>" [season] [episode]\n' +
        "  node scripts/moviebox-probe.mjs --detail <detailPath|link>\n" +
        '  node scripts/moviebox-probe.mjs --search "<naam>"',
    );
    process.exitCode = 2;
    return;
  }
  const detailOnly = args[0] === "--detail";
  const ref = parseMovieboxUrl(input);
  if (!ref) throw new Error(`Ye input parse nahi hua: ${input}`);
  console.error(`[probe] parsed: ${JSON.stringify(ref)}`);

  const detail = await getDetail(ref);
  if (!detail) throw new Error("Detail nahi mili — detailPath/subjectId check karo.");
  const s = detail.subject;
  const seasons = (detail.resource.seasons || []).map((x) => ({
    season: x.se,
    maxEp: x.maxEp,
    resolutions: (x.resolutions || []).map((r) => r.resolution),
  }));
  const summary = {
    title: s.title,
    subjectId: String(s.subjectId),
    detailPath: s.detailPath,
    type: s.subjectType === 1 ? "movie" : s.subjectType === 2 ? "tv" : "other",
    rating: s.imdbRatingValue || "",
    poster: s.cover?.url || "",
    dubs: (s.dubs || []).map((d) => `${d.lanName} (${d.lanCode}) → ${d.detailPath}`),
    seasons,
  };
  if (detailOnly) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const isTv = summary.type === "tv";
  const se = positional[1] != null ? Number(positional[1]) : ref.se ?? (isTv ? 1 : 0);
  const ep = positional[2] != null ? Number(positional[2]) : ref.ep ?? (isTv ? 1 : 0);
  console.error(`[probe] ${summary.title} — S${se}E${ep} ki stream dhundh raha hoon…`);

  const result = await resolveStreams({
    subjectId: summary.subjectId,
    detailPath: summary.detailPath,
    se,
    ep,
  });
  if (!result) {
    console.error(
      "[probe] Koi stream nahi mili. /subject/play rate-limit (~2-3 min/IP) ho sakta hai — ruk kar retry karo, ya episode number check karo.",
    );
    console.log(JSON.stringify({ ...summary, se, ep, sources: [] }, null, 2));
    process.exitCode = 1;
    return;
  }

  const best =
    result.sources.filter((x) => !x.vipLocked && x.kind !== "dash")[0] || result.sources[0];
  const out = { ...summary, se, ep, via: result.via, referer: result.referer, best, sources: result.sources };
  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`\n🎬 ${summary.title}  S${se}E${ep}  (via ${result.via})`);
  for (const x of result.sources) {
    console.log(
      `  ${x.resolution ? `${x.resolution}p` : "auto"} ${x.format} ${x.codec} ${x.sizeMB ? `${x.sizeMB}MB` : ""}${x.vipLocked ? " [VIP]" : ""}\n    ${x.url}`,
    );
  }
  console.log(`\n▶ Best (${best.resolution}p): ${best.url}`);
  console.log(`\n📥 Download (Referer zaroori hai, warna CDN 429 dega):`);
  console.log(`  curl -L -H "Referer: ${result.referer}" -H "User-Agent: ${UA}" -o video.mp4 "${best.url}"`);
  console.log(`\n📺 mpv me chalao:`);
  console.log(`  mpv --referrer="${result.referer}" "${best.url}"`);
  if (best.kind === "hls") {
    console.log(`\n🎞 ffmpeg (HLS → MP4):`);
    console.log(`  ffmpeg -headers "Referer: ${result.referer}\r\n" -i "${best.url}" -c copy video.mp4`);
  }
  console.log(`\n🌐 Vidd website me lagana hai to ye resolver URL row ke videoUrl/embedUrl me daalo (MP4 wala expire ho jayega):`);
  console.log(
    `  /api/moviebox?subjectId=${summary.subjectId}&detailPath=${summary.detailPath}&se=${se}&ep=${ep}`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv).catch((e) => {
    console.error(`[probe] FAIL: ${e.message}`);
    process.exitCode = 1;
  });
}
