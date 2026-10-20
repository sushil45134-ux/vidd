/**
 * MovieBox (m2box.org / moviebox.ph / MovieBox app mirrors) — shared helpers
 * ==========================================================================
 * MovieBox ka koi official iframe embed (`/embed/...`) NAHI hota — Nxsha ya
 * VidSrc se bilkul alag system hai. Saare working GitHub projects ek hi
 * rasta lete hain: MovieBox ki private H5 API
 * (`h5-api.aoneroom.com/wefeed-h5api-bff`) ko server-side call karke
 * direct MP4/HLS/DASH nikaalte hain aur apne player me chalaate hain.
 *
 * Ye file sirf PURE helpers rakhti hai (URL parse, resolver URL banana,
 * MD5) taaki browser (PlayerOverlay) aur server route (`/api/moviebox`)
 * dono ek hi logic share karein. Poora research + manual tareeka:
 * `docs/MOVIEBOX_EMBED.md`.
 */

/** MovieBox ke jaane-maane frontend mirrors (sab ek hi h5-api backend par). */
export const MOVIEBOX_HOSTS = [
  "m2box.org",
  "m2box.co",
  "m2box.app",
  "moviebox.ph",
  "movie-box.co",
  "movieboxonline.net",
  "movieboxhd.net",
  "moviebox.pk",
  "moviebox.ac",
  "officialmoviebox.com",
  "netnaija.film",
  "sflix.film",
  "123moviesfree.club",
  "h5.inmoviebox.com",
  "inmoviebox.com",
  "h5.aoneroom.com",
] as const;

export interface MovieboxRef {
  /** Numeric subject id, e.g. "8598850449111924848" (URL ka `?id=`). */
  subjectId?: string;
  /** Slug, e.g. "my-demon-hindi-SfaaEeePcfa" (URL path ka aakhri hissa). */
  detailPath?: string;
  /** Season (URL ka `detailSe=`), jab diya gaya ho. */
  se?: number;
  /** Episode (URL ka `detailEp=`), jab diya gaya ho. */
  ep?: number;
  /** Jis mirror host par link mila tha. */
  host?: string;
  raw: string;
}

export interface MovieboxSource {
  /** 360 / 480 / 720 / 1080 … (null = upstream ne nahi bataya). */
  resolution: number | null;
  /** "MP4" | "HLS" | "DASH" (upstream ka format, normalized). */
  format: string;
  kind: "mp4" | "hls" | "dash";
  /** Signed CDN URL — ghanton me expire hota hai, kabhi DB me save mat karo. */
  url: string;
  /** Hamara same-origin `/api/media-proxy` URL (Referer/CORS/Range safe). */
  proxyUrl: string;
  size: number | null;
  duration: number | null;
  codec: string;
  vipLocked: boolean;
}

const SUBJECT_ID_RE = /^\d{5,25}$/;
const DETAIL_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,160}$/;

export function isMovieboxSubjectId(value: string | null | undefined): boolean {
  return SUBJECT_ID_RE.test(String(value || "").trim());
}

export function isMovieboxDetailPath(value: string | null | undefined): boolean {
  return DETAIL_PATH_RE.test(String(value || "").trim());
}

function toPositiveInt(value: string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : undefined;
}

/**
 * Koi bhi MovieBox-ish input ko { subjectId, detailPath, se, ep } me todo.
 *
 * Samajhne wale roop:
 *   https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en
 *   https://<player-domain>/spa/videoPlayPage/movies/<detailPath>?id=<subjectId>&type=/movie/detail&detailSe=1&detailEp=2
 *   https://movieboxonline.net/videoPlayPage/<detailPath>?type=/movie/detail
 *   https://moviebox.ph/detail/<detailPath>  (aur /movies/ /movie/ /tv/ /play/ /watch/)
 *   my-demon-hindi-SfaaEeePcfa               (bare detailPath)
 *   8598850449111924848                      (bare subjectId)
 */
export function parseMovieboxInput(input: string): MovieboxRef | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  if (SUBJECT_ID_RE.test(raw)) return { subjectId: raw, raw };
  if (DETAIL_PATH_RE.test(raw) && /-/.test(raw)) return { detailPath: raw, raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(url.protocol)) return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let last = segments.length > 0 ? segments[segments.length - 1] : "";
  try {
    last = decodeURIComponent(last);
  } catch {
    // kharab %-encoding wala paste — raw segment hi rakho, regex aage dekh lega
  }

  const subjectIdParam =
    url.searchParams.get("id") ||
    url.searchParams.get("subjectId") ||
    url.searchParams.get("subject_id");
  const detailPathParam = url.searchParams.get("detailPath") || url.searchParams.get("detail_path");

  const ref: MovieboxRef = { host, raw };
  if (subjectIdParam && SUBJECT_ID_RE.test(subjectIdParam)) ref.subjectId = subjectIdParam;

  const detailPath =
    detailPathParam && DETAIL_PATH_RE.test(detailPathParam)
      ? detailPathParam
      : DETAIL_PATH_RE.test(last) && /-/.test(last)
        ? last
        : undefined;
  if (detailPath) ref.detailPath = detailPath;

  const se = toPositiveInt(
    url.searchParams.get("detailSe") ??
      url.searchParams.get("se") ??
      url.searchParams.get("season"),
  );
  const ep = toPositiveInt(
    url.searchParams.get("detailEp") ??
      url.searchParams.get("ep") ??
      url.searchParams.get("episode"),
  );
  if (se != null) ref.se = se;
  if (ep != null) ref.ep = ep;

  if (!ref.subjectId && !ref.detailPath) return null;
  return ref;
}

function hostLooksMoviebox(host: string): boolean {
  const h = host.toLowerCase();
  return (MOVIEBOX_HOSTS as readonly string[]).some(
    (known) => h === known || h.endsWith(`.${known}`),
  );
}

/**
 * True jab URL MovieBox ki watch/detail page lagti hai — matlab isse iframe
 * me daalna bekar hai (poori site + ads aayegi, domain bhi rotate hota hai);
 * isse hamare `/api/moviebox` resolver se direct video banana chahiye.
 *
 * Jaane-maane mirror hosts ke alawa un-rotated player domains ko bhi pakdo
 * jinki shakal player page jaisi hai (`/videoPlayPage/` ya `type=/movie/detail`
 * + numeric id + slug) — player domain har kuch hafto me badalta hai.
 */
export function isMovieboxUrl(input: string): boolean {
  const raw = String(input || "").trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const ref = parseMovieboxInput(raw);
  if (!ref?.detailPath && !ref?.subjectId) return false;
  if (hostLooksMoviebox(url.hostname)) return true;
  if (/videoPlayPage/i.test(url.pathname)) return true;
  return (
    url.searchParams.get("type") === "/movie/detail" &&
    isMovieboxSubjectId(url.searchParams.get("id")) &&
    !!ref.detailPath
  );
}

/**
 * Hamare resolver ka stable URL — yahi MovieBox ka "embed" hai Vidd ke liye.
 * Ise kisi row ke `videoUrl` (ya m2box link ko `embedUrl`) me rakho; har play
 * par server fresh signed MP4 nikaal kar dega (signed URL khud expire hota
 * hai, ye resolver URL kabhi nahi).
 */
export function buildMovieboxResolverUrl(
  input: string,
  opts: { se?: number; ep?: number; res?: number | "best" } = {},
): string | null {
  const ref = parseMovieboxInput(input);
  if (!ref) return null;
  const params = new URLSearchParams();
  if (ref.subjectId && ref.detailPath) {
    params.set("subjectId", ref.subjectId);
    params.set("detailPath", ref.detailPath);
  } else if (ref.detailPath) {
    params.set("detailPath", ref.detailPath);
  } else if (ref.subjectId) {
    params.set("subjectId", ref.subjectId);
  } else {
    return null;
  }
  const se = opts.se != null ? opts.se : ref.se;
  const ep = opts.ep != null ? opts.ep : ref.ep;
  if (se != null) params.set("se", String(se));
  if (ep != null) params.set("ep", String(ep));
  if (opts.res != null && opts.res !== "best") params.set("res", String(opts.res));
  return `/api/moviebox?${params.toString()}`;
}

/** MovieBox web player page ka URL — play API ko Referer me yahi chahiye. */
export function buildMovieboxPlayerPageUrl(
  domain: string,
  detailPath: string,
  subjectId: string,
  se: number,
  ep: number,
): string {
  const base = String(domain || "").replace(/\/+$/, "");
  return (
    `${base}/spa/videoPlayPage/movies/${encodeURIComponent(detailPath)}` +
    `?id=${encodeURIComponent(subjectId)}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`
  );
}

/** Full-page mode jis mirror par khulta hai (screenshot wali site). */
export const MOVIEBOX_SITE = "https://m2box.org";

/**
 * M2Box ke POORE watch page ka URL — player + Resources (episode grid) +
 * poori site, bilkul jaise m2box.org par khulta hai:
 *
 *   https://m2box.org/movies/{detailPath}?id={subjectId}&type=/movie/detail&detailSe={s}&detailEp={e}&lang=en
 *
 * `input` koi bhi m2box/moviebox link ho sakta hai (mirror SPA link bhi);
 * use parse karke canonical m2box.org page bana diya jata hai. Row ke
 * season/episode opts link wale detailSe/detailEp par jeette hain; kuch
 * na ho to detailSe/detailEp khali rehte hain (site khud pehla episode
 * kholta hai). Slug/id dono na milein to, agar input ek http(s) URL hai
 * to waisa ka waisa lauta do — page mode ke liye wahi best guess hai.
 */
export function buildMovieboxPageUrl(
  input: string,
  opts: { se?: number; ep?: number; site?: string } = {},
): string | null {
  const raw = String(input || "").trim();
  const ref = parseMovieboxInput(raw);
  if (!ref?.detailPath || !ref?.subjectId) {
    return /^https?:\/\//i.test(raw) ? raw : null;
  }
  const site = String(opts.site || MOVIEBOX_SITE).replace(/\/+$/, "");
  const se = opts.se != null ? opts.se : ref.se;
  const ep = opts.ep != null ? opts.ep : ref.ep;
  return (
    `${site}/movies/${encodeURIComponent(ref.detailPath)}` +
    `?id=${encodeURIComponent(ref.subjectId)}&type=/movie/detail` +
    `&detailSe=${se != null ? se : ""}&detailEp=${ep != null ? ep : ""}&lang=en`
  );
}

export interface MovieboxCrop {
  /** Screen par dikhne wale dabbe ki chaudai (px). */
  frameWidth: number;
  /** Iframe ke apne (stage) hisaab me upar se kata hissa — header+menu. */
  cropTop: number;
  /** Screen par dikhne wale dabbe ki unchai (px) — iske neeche kuch nahi dikhta. */
  height: number;
  /** Chhoti chaudai par site episode list ko player ke neeche rakh deti hai. */
  stacked: boolean;
  /** Iframe jis fixed chaudai par render hota hai (desktop par 1280). */
  stageWidth: number;
  /** Stage ko screen ke hisaab se kitna bada/chhota dikhana hai. */
  scale: number;
  /** Stage ke hisaab me dikhne wala hissa (iframe ki unchai = ye + cropTop). */
  stageVisibleHeight: number;
}

/** Desktop par iframe hamesha is fixed chaudai par render hota hai. */
export const MOVIEBOX_STAGE_WIDTH = 1280;
/** Stage par M2Box ka header+menu (upar se kata hua hissa). */
export const MOVIEBOX_STAGE_CROP_TOP = 116;
/**
 * Stage par dikhne wala hissa — cropTop (116) se page-y 560 tak.
 * Asli screenshot par pixel-naap (20 Oct 2026): player/panel ka
 * neeche wala kinara ≈551, uske neeche title/detail ≈579 se shuru.
 * Window 560 par khatm hoti hai: player ke 9px neeche, title se 19px
 * upar — controls poore dikhenge, title bilkul nahi. (Controls video
 * par overlay hote hain, alag bar neeche nahi hota.)
 */
export const MOVIEBOX_STAGE_VISIBLE_HEIGHT = 444;

/**
 * "Sirf Player" crop ka nap-tol.
 *
 * Desktop par iframe ko pehle ek FIXED 1280px wale stage par render
 * karte hain (site ka layout us ek chaudai par hamesha pakka rehta
 * hai), phir poore stage ko screen ke hisaab se scale kar dete hain.
 * Isse upar ka kata (header) aur neeche ka kata (player ke control-bar
 * ke just neeche) har screen par ekdum waisa hi padta hai. Nap asli
 * screenshots par naapa gaya hai; site apna layout kabhi badle to bas
 * upar wale teen number badalne hain.
 *
 * Chhoti screen (mobile) par stage nahi banta — wahan site episode
 * list ko player ke neeche rakh deti hai, to unchai player + controls
 * + episode grid ke hisaab se banti hai aur andar scroll khula rehta
 * hai (warna episodes tak pahuncha hi nahi jayega).
 */
export function getMovieboxCrop(outerWidth: number, outerHeight: number): MovieboxCrop {
  const w = outerWidth > 0 ? outerWidth : 1280;
  const stacked = w < 900;

  if (!stacked) {
    const scale = w / MOVIEBOX_STAGE_WIDTH;
    const wanted = MOVIEBOX_STAGE_VISIBLE_HEIGHT * scale;
    const height = outerHeight > 0 ? Math.min(wanted, outerHeight) : wanted;
    return {
      frameWidth: Math.round(w),
      cropTop: MOVIEBOX_STAGE_CROP_TOP,
      height: Math.round(height),
      stacked,
      stageWidth: MOVIEBOX_STAGE_WIDTH,
      scale,
      stageVisibleHeight: MOVIEBOX_STAGE_VISIBLE_HEIGHT,
    };
  }

  const cropTop = w >= 768 ? 112 : w >= 480 ? 108 : 104;
  const playerW = Math.max(0, w - 24);
  const playerH = (playerW * 9) / 16;
  // Video (controls usi par overlay hote hain) + halki saans + episode grid.
  const wanted = playerH + 16 + 320;
  const height = outerHeight > 0 ? Math.min(wanted, outerHeight) : wanted;
  return {
    frameWidth: Math.round(w),
    cropTop,
    height: Math.round(height),
    stacked,
    stageWidth: Math.round(w),
    scale: 1,
    stageVisibleHeight: Math.round(wanted),
  };
}

/**
 * `signCookie` ke andar chhupa asli manifest prefix nikaalo.
 *
 * Mobile-API wale kuch streams me `url` field jaan-boojh kar nakli/dummy
 * video hota hai; asal stream `signCookie` ke `urlprefix=` hisse me chhupa
 * hota hai aur uske aage `index.m3u8` / `index.mpd` jod kar banta hai.
 * Prefix mile to wahi return karo, warna null.
 */
export function manifestUrlFromSignCookie(
  signCookie: string | null | undefined,
  kind: "hls" | "dash",
): string | null {
  const raw = String(signCookie || "");
  if (!raw) return null;
  const candidates = [raw];
  try {
    candidates.push(decodeURIComponent(raw));
  } catch {
    // pehla (raw) roop hi kaafi hai
  }
  for (const text of candidates) {
    const m = text.match(/urlprefix=([^&;]+)/i);
    if (!m?.[1]) continue;
    let prefix = m[1].trim();
    try {
      prefix = decodeURIComponent(prefix);
    } catch {
      // jaisa hai waisa rakho
    }
    if (!/^https?:\/\//i.test(prefix)) continue;
    const file = kind === "dash" ? "index.mpd" : "index.m3u8";
    return prefix.endsWith(file) ? prefix : `${prefix.replace(/\/?$/, "/")}${file}`;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * MD5 (RFC 1321) — chhota pure-TS implementation.
 *
 * Kyun: (a) H5 search-suggest ka guest token `X-Client-Token:
 * <unix-sec>,<md5(reverse(unix-sec))>` Maangta hai; (b) mobile API ki
 * HMAC-MD5 signing bhi MD5 par khadi hai. WebCrypto me MD5 nahi hota aur
 * `node:crypto` har deploy target (Cloudflare Workers) par pakka nahi
 * milta, isliye yahi ek chhota sa implementation rakha hai. Sirf token
 * banane ke liye hai, kisi security kaam ke liye nahi.
 * ──────────────────────────────────────────────────────────────────────── */

const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function leftRotate(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/** UTF-8 string ka MD5, lowercase hex me. */
export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(String(input ?? ""));
  const bitLen = bytes.length * 8;
  // Padding: 0x80, phir zero bytes, phir 64-bit little-endian bit length.
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(paddedLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);
  for (let block = 0; block < paddedLen; block += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(block + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f = 0;
      let g = 0;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + (f >>> 0) + MD5_K[i] + words[g]) >>> 0;
      const next = (b + leftRotate(sum, MD5_S[i])) >>> 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  let hex = "";
  for (const byte of out) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * H5 web ka guest `X-Client-Token`: `<unix-seconds>,<md5(reverse(seconds))>`.
 * (Mobile app API isi formula ko milliseconds ke saath use karti hai —
 * docs dekho. Yahan web/H5 wala seconds version hai.)
 */
export function movieboxClientToken(nowMs: number = Date.now()): string {
  const sec = String(Math.floor(nowMs / 1000));
  return `${sec},${md5Hex(sec.split("").reverse().join(""))}`;
}
