# MovieBox (m2box.org) — "embed" kaise nikalein

## TL;DR — pehle ye samajh lo

**MovieBox ka koi official iframe embed hota hi nahi hai.** Nxsha / VidSrc /
2Embed ki tarah `moviebox.…/embed/movie/{id}` jaisa koi URL exist nahi karta.
GitHub par jitne bhi working MovieBox projects hain (list neeche), sab ek hi
kaam karte hain:

> MovieBox ka web player khud ek private JSON API bolta hai
> (`h5-api.aoneroom.com/wefeed-h5api-bff`). Wahi API server-side call karo,
> **direct MP4 (360p–1080p) / HLS** nikaalo, apne player me chalao.

Vidd ke liye wahi system bana diya hai — `/api/moviebox` (neeche "Vidd me
use" dekho). Admin ko karna sirf itna hai: **m2box link copy → movie/episode
row me paste** (Embed URL ya Video URL — dono chalenge). Player khud link
ko resolver se taaza MP4 bana kar chalata hai.

## Tumhari wali link ka anatomy

```
https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en
                         └──────────┬──────────┘      └────────┬───────┘                          └──┬──┘ └──┬──┘
                              detailPath (slug)         subjectId                            season   episode
```

Live verify (19 Oct 2026, is doc ke liye test kiya):
`GET https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath=my-demon-hindi-SfaaEeePcfa`
→ **My Demon [Hindi]**, `subjectId=8598850449111924848`, type `2` (TV),
**Season 1 = 16 episodes**, qualities per episode lag-bhag 360/720/1080
(480 sirf 1 episode par), rating 7.7, poster `pbcdnw.aoneroom.com/…`.
Dubs list me Hindi dub yahi subject hai; original Korean alag
`subjectId=6366028332823628072` (`detailPath=my-demon-hindi-UiDHFKAtgA7`) hai.
**Har dub = alag subjectId + alag detailPath** — Hindi chahiye to Hindi wala
slug hi use hoga.

m2box.org khud ek MovieBox mirror frontend hai (moviebox.ph,
movieboxonline.net, netnaija.film, officialmoviebox.com ke saath) — sab ek
hi `h5-api.aoneroom.com` backend share karte hain, isliye kisi bhi mirror
ka link chalega.

---

## Method 1 — Bina code, browser se direct MP4 (turant kaam)

Ek-baari link chahiye ho (download/VLC/test) to:

1. Chrome me m2box link kholo, video **Play** karo.
2. `F12` → **Network** tab → filter me `play` likho →
   `subject/play?subjectId=…` wali request kholo → **Response** me
   `data.streams[]` ke andar har quality ka `url` hai — wahi direct MP4 hai.
3. Ya Network me `mp4` filter kar ke video request par right-click →
   *Copy → Copy as cURL*.

⚠️ Teen baatein: (a) ye URL **signed hai, kuch ghanton me expire** ho jata
hai — website par permanent mat lagana; (b) CDN bina `Referer` ke **429**
deta hai — download ke liye header lagega:
`curl -L -H "Referer: https://moviebox.ph/" -o film.mp4 "<url>"`, VLC me
network-caching/http-referrer ya mpv `--referrer=` lagana padta hai;
(c) yehi kaam apne PC se script se karna hai to:
`node scripts/moviebox-probe.mjs "<m2box link>" 1 1` — ready-made
curl/mpv commands sahit sab print karega.

## Method 2 — H5 web API (recommended, Vidd me implemented)

Koi signing/login nahi lagta. Bas sahi headers ke saath ye 3 calls:

```text
1) Detail — subjectId/seasons/dubs (sirf ek id ho to dusra yahin milta hai)
   GET https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?detailPath={slug}
   GET https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId={id}   ← ye bhi chalta hai (verify kiya)

2) Player domain — ROTATE hota hai, hardcode kabhi mat karo
   GET https://h5-api.aoneroom.com/wefeed-h5api-bff/media-player/get-domain
   → { "data": "https://mzfi.me/" }          (19 Oct 2026 ko ye tha)

3) Streams — Referer EXACT player page ka ho, warna streams: [] milega
   GET {domain}/wefeed-h5api-bff/subject/play?subjectId={id}&se={s}&ep={e}&detailPath={slug}
   Referer: {domain}/spa/videoPlayPage/movies/{slug}?id={id}&type=/movie/detail&detailSe={s}&detailEp={e}&lang=en
   → data.streams[{url, resolutions, format:"MP4", size, duration, codecName}]
     + data.hls[] / data.dash[] (kabhi-kabhi)
```

Baaki kaam ki cheezein:

| Kaam | Endpoint |
|---|---|
| Play ka fallback (1080p `vipLocked` aata hai) | `GET {site}/wefeed-h5api-bff/subject/download?subjectId=&se=&ep=&detailPath=` (site = movieboxonline.net/m2box.org/moviebox.ph — h5-api par direct NAHI chalta) |
| Subtitles | `GET /wefeed-h5api-bff/subject/caption?format={stream.format}&id={stream.id}&subjectId=&detailPath=` → `data.captions[]` (signed SRT/VTT) |
| Search | pehle token lo, phir `POST /subject/search {"keyword":…,"page":1,"perPage":0,"subjectType":0}` |
| Trending | `GET /subject/trending?page=1&perPage=20` (bina token ke chalta hai) |
| Home/token | `GET /home?host=moviebox.ph` — response header `x-user` = `{"token":"<90-day guest JWT>"}`; wapas `Authorization: Bearer <token>` bhejo |

Search-suggest se token mint karne ka formula (jab `/home` wala token na
mile): `POST /subject/search-suggest` with header
`X-Client-Token: <unix-seconds>,<md5(reverse(unix-seconds-string))>` —
response ka `x-user` header guest JWT deta hai.

Headers jo har jagah chahiye: browser wala `User-Agent`,
`X-Client-Info: {"timezone":"Asia/Kolkata"}`, `X-Request-Lang: en`,
aur site ka `Referer`/`Origin`. Movie ke liye `se=0&ep=0`, series ke liye
`se=1&ep=1` se shuru.

**Gotchas (sab community-verified):**

- **Referer galat → khali jawab.** Bina player-page Referer ke play
  endpoint `{streams:[], hasResource:false, playConfig:{maxResolution:480}}`
  deta hai (live dekha hai). Browser se seedha API call isiliye kabhi
  kaam nahi karega — server-side call hi rasta hai.
- **Rate-limit:** `/subject/play` lag-bhag 1 successful call / 2–3 min /
  IP deta hai. Cache karna zaroori hai (`/api/moviebox` success 20 min,
  failure 60 s cache karta hai).
- **1080p hamesha free nahi:** `/subject/download` par 1080p `vipLocked`
  aata hai; aur MovieBox ke paid model ki wajah se kuch titles/regions me
  guest ko 480p par cap milta hai. Jo `streams[]` me aaya wahi sach hai.
- **CDN 429 + CORS:** MP4 links bina MovieBox Referer ke 429 dete hain aur
  CORS header nahi bhejte — browser me seedha `<video src>` fail hoga.
  Isliye Vidd har source ko `/api/media-proxy?u=…&referer=<player page>`
  se chalata hai (Range/seek bhi wahi sambhalta hai).
- **Domain rotation:** player domain (mzfi.me → netfilm.world → …) aur
  frontend mirrors badalte rehte hain. `get-domain` hamesha taaza bulao.
- **Codec:** kuch streams HEVC hote hain (`codecPriority: ["hevc","h264"]`).
  Har browser/TV HEVC MP4 nahi chala pata — black screen aaye to dusri
  quality try karo; pakka ilaaj server-side DASH→HLS transcode hai jo
  kuch frontends (neeche SagorT3K) ffmpeg se karte hain. Vidd abhi
  MP4/HLS tak seemit hai; DASH-only title par `sources` me dash milega
  lekin player use nahi chalata.

## Method 3 — Mobile app API (advanced, sirf zaroorat pade to)

MovieBox Android app dusra backend bolta hai:
`https://api.inmoviebox.com/wefeed-mobile-bff` (India build
`com.community.mbox.in`) / `api3…api6.aoneroom.com`. Kaam ke endpoints:
`POST /subject-api/search/v2 {"page","perPage","keyword"}`,
`GET /subject-api/play-info?subjectId=&se=&ep=`,
`GET /subject-api/get?subjectId=`.

Ye **signed** hai — har request par:

```text
canonical = "{METHOD}\napplication/json\napplication/json; charset=utf-8\n{bodyByteLen}\n{tsMs}\n{md5hex(body)}\n{path?sortedQuery}"
x-tr-signature: {tsMs}|2|{base64(HMAC-MD5(canonical, base64-decode(PRIMARY_KEY)))}
x-client-token: {tsMs},{md5hex(reverse(tsMs))}
User-Agent: com.community.mbox.in/… (Cronet)   •   x-client-info: {"package_name":"com.community.mbox.in"}
```

`PRIMARY_KEY` APK se nikaali hui secret hai — **repo me hardcode mat karo**,
env (`MOVIEBOX_PRIMARY_KEY`) me rakho jaise NuvioStreamsAddon karta hai.
Upar se naye versions me ek anti-piracy jaal hai: stream ka `url` field
nakli/dummy video ho sakta hai; asli manifest `signCookie` ke `urlprefix=`
hisse me chhupa hota hai — uske aage `index.m3u8`/`index.mpd` jodo
(`src/lib/moviebox.ts` ka `manifestUrlFromSignCookie` yahi karta hai) aur
wahi cookie CDN ko bhejni padti hai. Vidd ke liye Method 2 kaafi aur
sthir hai; ye rasta tab socho jab app-only catalogue chahiye ho.

## Method 4 — Ready-made GitHub APIs (khud host karne ke liye)

| Repo | Stack / tareeka | Kab use karo |
|---|---|---|
| `kelvinodgar-tech/Moviebox-API` | Zero-dep Node + Python scraper, H5 (Method 2) | Sabse saaf/sajha hua code padhna ho; `node server.js` se turant API |
| `faisaljs/Moviebox-API` (= `v-bit2`, `walterwhite-69` wali lineage) | FastAPI, H5, guest-JWT + player-domain + proxy | Python service alag se deploy karna ho |
| `tapframe/NuvioStreamsAddon` (`providers/moviebox.js`) | Stremio addon, India mobile API (Method 3) + Hindi/dub matching | TMDB-id → Hindi dub streams chahiye hain to iski matching logic best hai |
| `Keliura-Johnson/spun-moviebox-api`, `royalsofts6-eng/moviebox-api` | Cloudflare Worker / Node, mobile signed + HLS proxy | Edge par chalana ho to |
| `solo12345689/moviebox-internal-api` | APK reverse-engineering notes (`OFFICIAL_API_DOCUMENTATION.md`) | Signing/signCookie ki gehri detail |
| `SagorT3K/moviebox` | Poora frontend + dash.js + ffmpeg DASH→HLS transcode | HEVC/DASH wale titles browser me chalane ka pattern |
| `SANYAM7821/MovieBox-Api` | H5 wrapper (archived) | Sirf reference — "paid model, 480p cap" wali warning yahin se hai |

Public hosted demo instances par bharosa mat karo — aate-jaate rehte hain;
ya to khud ka ek chhota server rakho, ya seedha Vidd wala route use karo.

## Iframe wala "embed" try kiya to kya hoga?

`<iframe src="https://mzfi.me/spa/videoPlayPage/movies/{slug}?id={id}&type=/movie/detail&detailSe=1&detailEp=1&lang=en">`
ya m2box wali watch link frame kar sakte ho — lekin (1) domain rotate
hota hai, link achanak marega; (2) saaf player ki jagah poori site, ads aur
"Download APP" banner aayenge; (3) site kabhi bhi `X-Frame-Options`/CSP
laga kar framing band kar sakti hai; (4) Vidd ke sandbox/ad-block
niyam isse ladenge. Isi liye koi bhi ciddi project iframe nahi karta —
Method 2 hi asal "embed" hai.

## Vidd me use — jo bana diya gaya hai

**Admin ke liye (sabse asaan):** Upload/edit me movie ya har episode ki
row par **Embed URL (ya Video URL) me poori m2box link paste kar do**.
Player MovieBox link ko khud pehchanta hai aur iframe ki jagah resolver se
 MP4 chalata hai. Episode rows par Season/Episode number bhare hon to har
row par **wahi ek base link** paste chalega — number row se aa jayega;
number na hon to link ke `detailSe/detailEp` use honge.

**Resolver URL seedha lagana ho to** (Video URL field):

```
/api/moviebox?subjectId=8598850449111924848&detailPath=my-demon-hindi-SfaaEeePcfa&se=1&ep=1
```

**API cheatsheet:**

```text
Stream JSON : /api/moviebox?url=<encoded m2box link>&se=1&ep=1        → { ok, streamUrl, kind, sources[], dubs[], seasons[] }
Seedha play : /api/moviebox?detailPath=<slug>&se=1&ep=1&format=play   → 302 → media-proxy MP4 (VLC/<video>)
Quality cap : …&res=720
Sirf detail : /api/moviebox?mode=detail&detailPath=<slug>              → poster/seasons/dubs/cast
Subtitles   : /api/moviebox?mode=captions&detailPath=<slug>&se=1&ep=1
Search      : /api/moviebox?mode=search&q=My+Demon+Hindi               → har item ke saath ready resolverUrl
Debug       : upar kisi me bhi &debug=1                                 → har upstream attempt ki trace
```

| File | Kaam |
|---|---|
| `src/routes/api/moviebox.ts` | Server resolver (detail → get-domain → play → media-proxy URLs), cache + search/captions |
| `src/lib/moviebox.ts` | Link parse, resolver URL, player-page Referer, signCookie manifest, MD5 (client+server shared) |
| `src/components/PlayerOverlay.tsx` | m2box link (embedUrl/videoUrl) → khud resolver video me badalta hai |
| `src/components/EmbedPlayer.tsx` | `/api/extract` ki tarah `/api/moviebox` ko bhi resolver-backed video maanta hai |
| `scripts/moviebox-probe.mjs` | PC/VPS se standalone test/download (`--search`, `--detail`, `--json`) |
| `scripts/moviebox.test.mjs` | Offline tests: `node scripts/moviebox.test.mjs` |

**Env (optional):** `MOVIEBOX_HOST` (default `moviebox.ph`) — token-mint
aur `?host=` ke liye frontend host badalna ho to.

**Troubleshooting:** "koi stream nahi mili" aaye to pehle 2–3 min ruk kar
retry (play rate-limit), phir `&debug=1` wali trace dekho ki kauna attempt
kya lauta raha hai, phir apne PC se `moviebox-probe.mjs` chala kar dekho
(server ka IP region-blocked ho to wahan chalega). MP4 URL kabhi DB me
paste mat karo — expire hoga hi hoga; hamesha link/resolver rakho.

> Note: ye sab MovieBox ke private, bina-document wale endpoints par
> nirbhar hai — upstream kabhi bhi badal sakta hai, aur content ke
> rights/terms ka dhyan rakhna site chalane wale ki zimmedari hai.
