import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/nxsha-fetch — Nxsha DIRECT episode fetch (source of truth)
 * ================================================================
 * Nxsha (nxsha.space) ka poora catalogue TMDB ka mirror hai — embed URL me
 * wahi TMDB numeric id chalta hai (`/embed/tv/{tmdbId}/{s}/{e}`), aur uske
 * player ka Episodes list bhi TMDB ke season data se hi banta hai.
 *
 * Isliye ye route AniList/Jikan ko puri tarah bypass karta hai aur seedha
 * TMDB ke server-rendered pages scrape karta hai (koi API key nahi chahiye):
 *
 *   1. themoviedb.org/tv/{id}            → title, poster, backdrop, genres
 *   2. themoviedb.org/tv/{id}/season/{n} → REAL episode list (number, naam,
 *      air-date, thumbnail) — exactly wahi jo Nxsha ke player me dikhta hai
 *
 * Sirf AIRED episodes return hote hain (air date <= aaj), kyunki Nxsha ke
 * paas future episodes ki stream nahi hoti. Isse "12 me se sirf 1 aaya"
 * jaisi AniList/Jikan wali problem kabhi nahi hogi.
 *
 * Query params:
 *   q        = TMDB link | Nxsha embed link | TMDB numeric id | show ka naam
 *   specials = "1" → Season 0 (Specials) bhi include karo (default off)
 */

const TMDB = "https://www.themoviedb.org";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_SEASONS = 30;
/** Same-day releases ke liye halka sa grace window (timezones). */
const AIR_GRACE_MS = 36 * 60 * 60 * 1000;

export interface NxshaEpisodeOut {
  episodeNumber: number;
  title: string;
  aired: string; // ISO date ya ""
  image: string; // TMDB episode still ya ""
  runtime: string; // "24m" ya ""
}

export interface NxshaSeasonOut {
  seasonNumber: number;
  title: string;
  episodesCount: number; // TMDB header count (future eps included)
  airedCount: number;
  episodes: NxshaEpisodeOut[]; // sirf aired
}

export interface NxshaFetchOut {
  tmdbId: string;
  title: string;
  year?: number;
  overview: string;
  poster: string;
  backdrop: string;
  genres: string[];
  totalSeasons: number;
  totalAired: number;
  totalEpisodes: number;
  seasons: NxshaSeasonOut[];
  sampleEmbed: string;
  source: "nxsha-tmdb";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** q se TMDB numeric id nikaalo — link, nxsha embed, plain id, ya naam-search. */
async function resolveTmdbId(q: string): Promise<{ id: string | null; via: string }> {
  // themoviedb.org/tv/312949-slug… ya nxsha.space/embed/tv/312949/1/1 — dono
  const linkMatch = q.match(/\/tv\/(\d{1,10})(?:\b|[-/])/);
  if (linkMatch) return { id: linkMatch[1], via: "link" };
  const bare = q.trim();
  if (/^\d{1,10}$/.test(bare)) return { id: bare, via: "id" };
  if (/^tt\d{6,10}$/i.test(bare)) {
    // IMDb id → TMDB search bhi tt id samajh leta hai (remote search)
    const html = await fetchHtml(
      `${TMDB}/search/tv?query=${encodeURIComponent(bare)}&language=en-US`,
    );
    const m = html?.match(/\/tv\/(\d{1,10})[-"?]/);
    if (m) return { id: m[1], via: "imdb-search" };
    return { id: null, via: "imdb-search" };
  }
  // Naam se TMDB TV search (server-rendered page)
  const html = await fetchHtml(
    `${TMDB}/search/tv?query=${encodeURIComponent(bare)}&language=en-US`,
  );
  const m = html?.match(/\/tv\/(\d{1,10})[-"?]/);
  return { id: m ? m[1] : null, via: "search" };
}

function parseShow(html: string): {
  title: string;
  year?: number;
  overview: string;
  poster: string;
  backdrop: string;
  genres: string[];
} {
  const og = (prop: string) => {
    const m =
      html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]*)"`, "i")) ||
      html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="og:${prop}"`, "i"));
    return m ? decodeEntities(m[1]) : "";
  };
  let title = og("title") || decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1] || "");
  let year: number | undefined;
  const ym = title.match(/\((?:TV Series\s*)?(\d{4})(?:[–-]\s*\d{0,4})?\)/);
  if (ym) year = Number(ym[1]);
  title = title
    .replace(/\s*\((?:TV Series\s*)?\d{4}[^)]*\)\s*/g, " ")
    .replace(/\s*—\s*The Movie Database.*$/i, "")
    .trim();

  let poster = og("image");
  if (poster.startsWith("//")) poster = "https:" + poster;
  // og:image chhota ho sakta hai — bade size pe upgrade
  poster = poster.replace(/\/t\/p\/w\d+(_and_[^/]+)?\//, "/t/p/w500/");

  const backdropMatch = html.match(
    /https:\/\/(?:media|image)\.themoviedb\.org\/t\/p\/w1920_and_h800_multi_faces\/[A-Za-z0-9._-]+/,
  );
  const backdrop = backdropMatch
    ? backdropMatch[0].replace("w1920_and_h800_multi_faces", "w1280")
    : poster;

  const genres = Array.from(
    new Set(
      Array.from(html.matchAll(/href="\/genre\/\d+[^"]*"[^>]*>([^<]+)</g)).map((m) =>
        decodeEntities(m[1]),
      ),
    ),
  ).filter(Boolean);

  const overview = og("description");
  return { title, year, overview, poster, backdrop, genres };
}

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

function parseSeasonPage(
  html: string,
  seasonNumber: number,
): { episodesCount: number; episodes: NxshaEpisodeOut[] } {
  // Header: "Episodes 12" (count me future/unaired bhi hote hain)
  const countMatch = html.match(/Episodes\s*(?:<[^>]*>\s*)*(\d{1,4})/);
  const episodesCount = countMatch ? Number(countMatch[1]) : 0;

  // Episode number + naam — canonical title attributes se (class-agnostic):
  //   title="Show: Season 1 (2026): Episode 3 - I'm More Straight Than Funny, Nya"
  const titles = new Map<number, string>();
  for (const m of html.matchAll(/title="[^"]*Episode\s+(\d{1,4})\s+-\s+([^"]+)"/g)) {
    const num = Number(m[1]);
    if (!titles.has(num)) titles.set(num, decodeEntities(m[2]));
  }
  // Episode numbers — /season/{s}/episode/{e} links se (extra safety net)
  const nums = new Set<number>(titles.keys());
  const linkRe = new RegExp(`/season/${seasonNumber}/episode/(\\d{1,4})`, "g");
  // Har episode ke FIRST link ki position bhi yaad rakho — usse HTML ko
  // per-episode segments me kaata jata hai (date/thumbnail sahi ep ke saath).
  const firstPos = new Map<number, number>();
  for (const m of html.matchAll(linkRe)) {
    const num = Number(m[1]);
    nums.add(num);
    if (!firstPos.has(num)) firstPos.set(num, m.index ?? 0);
  }

  const ordered = Array.from(nums).sort((a, b) => a - b);

  // Position ke hisaab se segments banao: ep N ka segment = uske pehle link
  // se agle ep ke pehle link tak. Isme uski date, still, runtime milte hain.
  const byPos = ordered
    .filter((n) => firstPos.has(n))
    .sort((a, b) => firstPos.get(a)! - firstPos.get(b)!);
  const segments = new Map<number, string>();
  for (let i = 0; i < byPos.length; i++) {
    const start = firstPos.get(byPos[i])!;
    const end =
      i + 1 < byPos.length ? firstPos.get(byPos[i + 1])! : Math.min(html.length, start + 8000);
    segments.set(byPos[i], html.slice(start, end));
  }

  const dateRe = new RegExp(`(?:${MONTHS})\\s+\\d{1,2},\\s+\\d{4}`);
  const stillRe = /https:\/\/media\.themoviedb\.org\/t\/p\/w\d+_and_h\d+_face\/[A-Za-z0-9._-]+/;
  const runtimeRe = /•\s*(\d{1,3}m|\d+h(?:\s*\d+m)?)/;

  const episodes: NxshaEpisodeOut[] = ordered.map((num) => {
    const seg = segments.get(num) || "";
    const dateStr = seg.match(dateRe)?.[0].replace(/\s+/g, " ") || "";
    const ts = dateStr ? Date.parse(dateStr) : NaN;
    const still = seg.match(stillRe)?.[0] || "";
    return {
      episodeNumber: num,
      title: titles.get(num) || `Episode ${num}`,
      aired: Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "",
      image: still ? still.replace(/w\d+_and_h\d+_face/, "w500") : "",
      runtime: seg.match(runtimeRe)?.[1] || "",
    };
  });

  return { episodesCount, episodes };
}

export const Route = createFileRoute("/api/nxsha-fetch")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") || "").trim();
        const includeSpecials = url.searchParams.get("specials") === "1";
        if (!q) {
          return Response.json(
            { error: "q required — TMDB link, Nxsha link, TMDB id ya show ka naam do" },
            { status: 400 },
          );
        }

        try {
          const { id: tmdbId } = await resolveTmdbId(q);
          if (!tmdbId) {
            return Response.json(
              {
                error: `"${q}" ke liye TMDB par kuch nahi mila. TMDB link ya numeric ID try karo.`,
              },
              { status: 404 },
            );
          }

          const mainHtml = await fetchHtml(`${TMDB}/tv/${tmdbId}?language=en-US`);
          if (!mainHtml) {
            return Response.json(
              { error: `TMDB id ${tmdbId} nahi mila (themoviedb.org/tv/${tmdbId} 404).` },
              { status: 404 },
            );
          }
          const show = parseShow(mainHtml);

          const now = Date.now() + AIR_GRACE_MS;
          const seasons: NxshaSeasonOut[] = [];
          let totalAired = 0;
          let totalEpisodes = 0;

          const startSeason = includeSpecials ? 0 : 1;
          for (let s = startSeason; s <= MAX_SEASONS; s++) {
            const html = await fetchHtml(`${TMDB}/tv/${tmdbId}/season/${s}?language=en-US`);
            if (!html) {
              if (s === 0) continue; // Specials nahi hai to S1 se chalu
              break; // aage koi season nahi
            }
            const { episodesCount, episodes } = parseSeasonPage(html, s);
            if (episodesCount === 0 && episodes.length === 0) {
              if (s === 0) continue;
              break;
            }

            // Sirf AIRED episodes — Nxsha ke paas future eps nahi hote.
            // Agar page pe koi bhi date parse nahi hui (data gap), sab rakho.
            const anyDates = episodes.some((e) => e.aired);
            const aired = anyDates
              ? episodes.filter((e) => e.aired && Date.parse(e.aired) <= now)
              : episodes;

            seasons.push({
              seasonNumber: s,
              title: s === 0 ? `${show.title} — Specials` : `${show.title} Season ${s}`,
              episodesCount: episodesCount || episodes.length,
              airedCount: aired.length,
              episodes: aired,
            });
            totalAired += aired.length;
            totalEpisodes += episodesCount || episodes.length;
          }

          if (seasons.length === 0) {
            return Response.json(
              { error: `TMDB id ${tmdbId} me koi season/episode parse nahi hua.` },
              { status: 404 },
            );
          }

          const first = seasons.find((se) => se.airedCount > 0) || seasons[0];
          const result: NxshaFetchOut = {
            tmdbId,
            title: show.title,
            year: show.year,
            overview: show.overview,
            poster: show.poster,
            backdrop: show.backdrop,
            genres: show.genres,
            totalSeasons: seasons.length,
            totalAired,
            totalEpisodes,
            seasons,
            sampleEmbed: `https://nxsha.space/embed/tv/${tmdbId}/${first.seasonNumber}/1?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true`,
            source: "nxsha-tmdb",
          };

          // 5 min cache — naye episodes jaldi dikhne chahiye
          return Response.json(result, {
            headers: { "cache-control": "public, max-age=300" },
          });
        } catch (err) {
          console.error("[nxsha-fetch] error", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Nxsha/TMDB fetch fail ho gaya" },
            { status: 500 },
          );
        }
      },
    },
  },
});
