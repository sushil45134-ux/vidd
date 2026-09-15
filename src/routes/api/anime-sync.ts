import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/anime-sync — New Episode Auto-Sync (no API key needed)
 * =====================================================================
 * Nxsha/NHD embeds are IMDb-ID based templates (/tv/{id}/{s}/{e}), so the
 * player can already play ANY episode. What is missing when a new episode
 * airs is only the episode CARD (row) in Supabase.
 *
 * This endpoint:
 *   1. Reads all auto-fetched anime collections (playlist_id like 'anime-auto-%')
 *      from Supabase (public read).
 *   2. Groups them by collection + season, finds the max episode number in DB.
 *   3. Asks AniList how many episodes have actually AIRED so far
 *      (nextAiringEpisode / status / episodes) — including NEW seasons via
 *      the prequel/sequel relation chain.
 *   4. Fetches new-episode metadata (title, synopsis, thumbnail) from Jikan.
 *   5. Returns ready-to-insert Movie rows built with the SAME embed template
 *      that the existing episodes use.
 *
 * The client (admin, logged-in) inserts the rows — RLS only allows
 * authenticated writes, so this endpoint never writes to Supabase itself.
 * For fully hands-off cron sync use scripts/anime-sync.mjs + GitHub Actions
 * with a SUPABASE_SERVICE_ROLE_KEY secret.
 *
 * Query params:
 *   playlistId   = optional, only check one collection
 *   maxPerSeason = optional cap on new episodes per season (default 50)
 */

const SUPABASE_URL = "https://yjakihgnxntjfjvarxmt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do";

const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_BASE = "https://api.jikan.moe/v4";
const DEFAULT_MAX_PER_SEASON = 50;

/* ────────────────────────────── AniList ────────────────────────────── */

interface SyncMedia {
  id: number;
  idMal?: number;
  status?: string; // RELEASING | FINISHED | NOT_YET_RELEASED ...
  episodes?: number; // total planned episodes
  format?: string;
  type?: string;
  seasonYear?: number;
  startDate?: { year?: number };
  title: { romaji: string; english?: string; native?: string };
  coverImage?: { extraLarge?: string; large?: string };
  bannerImage?: string;
  nextAiringEpisode?: { episode: number; airingAt: number };
  relations?: {
    edges: { relationType: string }[];
    nodes: SyncMedia[];
  };
}

const SYNC_FIELDS = `
  id
  idMal
  status
  episodes
  format
  seasonYear
  startDate { year }
  title { romaji english native }
  coverImage { extraLarge large }
  bannerImage
  nextAiringEpisode { episode airingAt }
`;

const SYNC_SEARCH_QUERY = `
query ($search: String) {
  Page(perPage: 10) {
    media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      ${SYNC_FIELDS}
    }
  }
}
`;

const SYNC_DETAILS_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${SYNC_FIELDS}
    relations {
      edges { relationType }
      nodes {
        ${SYNC_FIELDS}
        type
      }
    }
  }
}
`;

// AniList responses are untyped GraphQL JSON — same convention as anime-auto.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastAnilistCall = 0;
async function anilistFetch(query: string, variables: Record<string, unknown>): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const gap = 700 - (Date.now() - lastAnilistCall);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    lastAnilistCall = Date.now();
    const res = await fetch(ANILIST_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }) });
    if (res.status === 429) { if (attempt === 3) throw new Error("AniList 429"); await new Promise((r) => setTimeout(r, 20000 * (attempt + 1))); continue; }
    if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(`AniList ${res.status}: ${txt.slice(0, 200)}`); }
    const json = await res.json();
    if (json.errors) throw new Error(`AniList error: ${JSON.stringify(json.errors).slice(0, 300)}`);
    return json.data;
  }
  return null;
}
async function anilistBatchSearch(titles: string[]): Promise<SyncMedia[][]> {
  const out: SyncMedia[][] = [];
  for (let start = 0; start < titles.length; start += 10) {
    const chunk = titles.slice(start, start + 10), vars: Record<string, unknown> = {}, fields: string[] = [];
    chunk.forEach((title, i) => { vars[`q${i}`] = title; fields.push(`q${i}: Page(perPage: 10) { media(search: $q${i}, type: ANIME, sort: POPULARITY_DESC) { ${SYNC_FIELDS} } }`); });
    const defs = chunk.map((_, i) => `$q${i}: String`).join(", ");
    const data = await anilistFetch(`query (${defs}) { ${fields.join(" ")} }`, vars);
    out.push(...chunk.map((_, i) => data?.[`q${i}`]?.media || []));
  }
  return out;
}
async function anilistBatchDetails(ids: (number | undefined)[]): Promise<(SyncMedia | null)[]> {
  const out: (SyncMedia | null)[] = Array(ids.length).fill(null);
  for (let start = 0; start < ids.length; start += 10) {
    const chunk = ids.slice(start, start + 10), vars: Record<string, unknown> = {}, fields: string[] = [], positions: [number, number][] = [];
    chunk.forEach((id, i) => { if (id == null) return; vars[`i${i}`] = id; positions.push([i, start + i]); fields.push(`i${i}: Media(id: $i${i}, type: ANIME) { ${SYNC_FIELDS} relations { edges { relationType } nodes { ${SYNC_FIELDS} type } } }`); });
    if (!fields.length) continue;
    const defs = positions.map(([i]) => `$i${i}: Int`).join(", ");
    const data = await anilistFetch(`query (${defs}) { ${fields.join(" ")} }`, vars);
    positions.forEach(([i, pos]) => { out[pos] = data?.[`i${i}`] || null; });
  }
  return out;
}

function bestTitle(t: SyncMedia["title"]): string {
  return t.english || t.romaji || t.native || "Unknown";
}

function titleVariants(t: SyncMedia["title"]): string[] {
  const out: string[] = [];
  if (t.english) out.push(t.english.toLowerCase());
  if (t.romaji) out.push(t.romaji.toLowerCase());
  if (t.native) out.push(t.native.toLowerCase());
  return out;
}

function scoreTitleMatch(query: string, candidate: string): number {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();
  if (c === q) return 100;
  if (c.startsWith(q)) return 90;
  if (c.includes(q)) return 80;
  if (q.includes(c)) return 70;
  const qWords = q.split(/[\s:]+/).filter((w) => w.length > 2);
  const cWords = c.split(/[\s:]+/).filter((w) => w.length > 2);
  const common = qWords.filter((w) => cWords.includes(w)).length;
  return qWords.length > 0 ? Math.round((common / qWords.length) * 60) : 0;
}

function pickBest(query: string, results: SyncMedia[]): SyncMedia | null {
  if (results.length === 0) return null;
  const scored = results
    .map((m) => {
      let best = 0;
      for (const v of titleVariants(m.title)) {
        const s = scoreTitleMatch(query, v);
        if (s > best) best = s;
      }
      if (m.idMal) best += 5;
      if (m.status === "RELEASING") best += 3; // currently airing = likely the right one
      return { m, best };
    })
    .sort((a, b) => b.best - a.best);
  return scored[0]?.m || results[0];
}

/** prequels (year asc) → main → sequels (year asc), deduped. */
function buildChain(main: SyncMedia): SyncMedia[] {
  const edges = main.relations?.edges || [];
  const nodes = main.relations?.nodes || [];
  const related: { media: SyncMedia; rel: string; year: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rel = edges[i]?.relationType || "";
    if (!node) continue;
    if (node.type && node.type !== "ANIME") continue;
    if (node.format && !["TV", "TV_SHORT", "ONA", "OVA"].includes(node.format)) continue;
    if (rel !== "PREQUEL" && rel !== "SEQUEL") continue;
    related.push({ media: node, rel, year: node.startDate?.year || node.seasonYear || 9999 });
  }
  const prequels = related.filter((r) => r.rel === "PREQUEL").sort((a, b) => a.year - b.year);
  const sequels = related.filter((r) => r.rel === "SEQUEL").sort((a, b) => a.year - b.year);
  const chain: SyncMedia[] = [
    ...prequels.map((r) => r.media),
    main,
    ...sequels.map((r) => r.media),
  ];
  const seen = new Set<number>();
  return chain.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).slice(0, 10);
}

/** How many episodes of this media have aired so far. */
function airedCount(media: SyncMedia): { aired: number; known: boolean } {
  if (media.nextAiringEpisode) {
    return { aired: media.nextAiringEpisode.episode - 1, known: true };
  }
  if (media.status === "FINISHED") {
    return { aired: media.episodes || 0, known: true };
  }
  return { aired: 0, known: false };
}

/* ─────────────────────────────── Jikan ─────────────────────────────── */

interface JikanEp {
  mal_id: number;
  title: string;
  synopsis?: string;
  images?: { jpg?: { image_url?: string } };
}

/** Fetch only as many pages as needed to cover `upToEpisode`. */
async function jikanEpisodesUpTo(
  malId: number,
  upToEpisode: number,
): Promise<Map<number, JikanEp>> {
  const out = new Map<number, JikanEp>();
  const maxPage = Math.max(1, Math.ceil(upToEpisode / 100) + 1);
  for (let page = 1; page <= Math.min(maxPage, 12); page++) {
    try {
      if (page > 1) await new Promise((r) => setTimeout(r, 450)); // Jikan: 3 req/sec
      const res = await fetch(`${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`, {
        headers: { "User-Agent": "vid-anime-sync/1.0" },
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500));
        page--;
        continue;
      }
      if (!res.ok) break;
      const json = await res.json();
      const data: JikanEp[] = json.data || [];
      if (data.length === 0) break;
      for (const ep of data) out.set(ep.mal_id, ep);
      if (out.has(upToEpisode)) break;
      if (json.pagination?.has_next_page !== true) break;
    } catch {
      break;
    }
  }
  return out;
}

/* ─────────────────────────── Supabase read ─────────────────────────── */

interface DbRow {
  id: number;
  title: string;
  year: number;
  rating: string;
  duration: string;
  genre: string[];
  match_score: number;
  cast_members: string[] | null;
  creator: string | null;
  image: string;
  backdrop: string | null;
  embed_url: string | null;
  embed_platform: string | null;
  playlist_id: string;
  playlist_title: string | null;
  season_number: number | null;
  episode_number: number | null;
}

const SYNC_COLUMNS =
  "id,title,year,rating,duration,genre,match_score,cast_members,creator,image,backdrop,embed_url,embed_platform,playlist_id,playlist_title,season_number,episode_number";

async function readAnimeCollections(onlyPlaylistId?: string): Promise<DbRow[]> {
  const rows: DbRow[] = [];
  const pageSize = 1000;
  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/movies`);
    url.searchParams.set("select", SYNC_COLUMNS);
    url.searchParams.set(
      "playlist_id",
      onlyPlaylistId ? `eq.${onlyPlaylistId}` : "like.anime-auto-*",
    );
    url.searchParams.set("season_number", "not.is.null");
    url.searchParams.set("episode_number", "not.is.null");
    url.searchParams.set("order", "playlist_id,season_number,episode_number");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(rows.length));
    const res = await fetch(url.toString(), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase read failed ${res.status}`);
    const data: DbRow[] = await res.json();
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

/* ─────────────────────────── plan building ─────────────────────────── */

interface EmbedTemplate {
  imdbId: string;
  template: string; // with {id} {s} {e}
  provider: string;
}

/** Extract IMDb id + reusable template from an existing episode embed URL. */
function parseEmbedTemplate(embedUrl: string): EmbedTemplate | null {
  const m = embedUrl.match(/\/tv\/([^/?]+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  const imdbId = decodeURIComponent(m[1]);
  const template = embedUrl.replace(`/tv/${m[1]}/${m[2]}/${m[3]}`, "/tv/{id}/{s}/{e}");
  const lower = embedUrl.toLowerCase();
  const provider = lower.includes("nxsha") ? "Nxsha" : lower.includes("nhdapi") ? "NHD" : "Embed";
  return { imdbId, template, provider };
}

function buildEmbed(template: string, imdbId: string, s: number, e: number): string {
  return template
    .replace(/\{id\}/g, encodeURIComponent(imdbId))
    .replace(/\{s\}/g, String(s))
    .replace(/\{e\}/g, String(e));
}

interface SyncRow {
  title: string;
  description: string;
  image: string;
  backdrop?: string;
  thumbnailUrl?: string;
  year: number;
  rating: string;
  duration: string;
  genre: string[];
  match: number;
  cast?: string[];
  creator?: string;
  embedUrl: string;
  embedPlatform?: string;
  playlistId: string;
  playlistTitle: string;
  episodeNumber: number;
  seasonNumber: number;
}

interface SeasonSyncInfo {
  seasonNumber: number;
  seasonTitle: string;
  anilistId?: number;
  malId?: number;
  anilistStatus?: string;
  dbEpisodes: number;
  airedEpisodes: number;
  totalExpected?: number;
  isNewSeason: boolean;
  reason?: string;
  newEpisodes: SyncRow[];
}

interface CollectionSyncInfo {
  playlistId: string;
  playlistTitle: string;
  imdbId?: string;
  provider?: string;
  status: "ok" | "skipped";
  reason?: string;
  seasons: SeasonSyncInfo[];
}

/** Guess the season display title from existing episode titles. */
function seasonTitleFromRows(rows: DbRow[], playlistTitle: string, seasonNumber: number): string {
  const first = rows[0];
  if (first?.title?.includes(" - ")) return first.title.split(" - ")[0].trim();
  if (first?.title && /episode\s+\d+$/i.test(first.title)) {
    return first.title.replace(new RegExp(`\\s*episode\\s+\\d+$`, "i"), "").trim() || playlistTitle;
  }
  return seasonNumber > 1 ? `${playlistTitle} Season ${seasonNumber}` : playlistTitle;
}

export const Route = createFileRoute("/api/anime-sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const onlyPlaylistId = url.searchParams.get("playlistId") || undefined;
        const maxPerSeason = Math.min(
          Math.max(1, Number(url.searchParams.get("maxPerSeason") || DEFAULT_MAX_PER_SEASON)),
          100,
        );

        try {
          const rows = await readAnimeCollections(onlyPlaylistId);
          if (rows.length === 0) {
            return Response.json({
              ok: true,
              checkedAt: new Date().toISOString(),
              collections: [],
              totalNewEpisodes: 0,
              movies: [],
              note: "No auto-fetched anime collections found (playlist_id like anime-auto-%).",
            });
          }

          // group: playlistId -> seasonNumber -> rows
          const collections = new Map<
            string,
            { title: string; seasons: Map<number, DbRow[]>; template: EmbedTemplate | null }
          >();
          for (const row of rows) {
            let col = collections.get(row.playlist_id);
            if (!col) {
              col = {
                title: row.playlist_title || row.playlist_id,
                seasons: new Map(),
                template: null,
              };
              collections.set(row.playlist_id, col);
            }
            const sn = row.season_number || 1;
            if (!col.seasons.has(sn)) col.seasons.set(sn, []);
            col.seasons.get(sn)!.push(row);
            if (!col.template && row.embed_url) {
              col.template = parseEmbedTemplate(row.embed_url);
            }
          }

          const resultCollections: CollectionSyncInfo[] = [];
          const allNewRows: SyncRow[] = [];
          const collectionList = [...collections.values()];
          const searchResults = await anilistBatchSearch(collectionList.map((c) => c.title));
          const picked = searchResults.map((r, i) => pickBest(collectionList[i].title, r));
          const detailed = await anilistBatchDetails(picked.map((m) => m?.id));
          const prefetched = new Map(collectionList.map((c, i) => [c, detailed[i] || picked[i]]));

          for (const [playlistId, col] of collections {
            const info: CollectionSyncInfo = {
              playlistId,
              playlistTitle: col.title,
              imdbId: col.template?.imdbId,
              provider: col.template?.provider,
              status: "ok",
              seasons: [],
            };

            if (!col.template) {
              info.status = "skipped";
              info.reason = "No IMDb-style embed URL (/tv/{id}/{s}/{e}) found in this collection.";
              resultCollections.push(info);
              continue;
            }

            // AniList data was prefetched in aliased batches before the loop.
            const prefetchedMedia = prefetched.get(col);
            if (prefetchedMedia) chain = buildChain(prefetchedMedia);
            if (chain.length === 0) {
              info.status = "skipped";
              info.reason = `AniList par "${col.title}" nahi mila.`;
              resultCollections.push(info);
              continue;
            }

            const sortedSeasonNums = Array.from(col.seasons.keys()).sort((a, b) => a - b);
            const maxDbSeason = sortedSeasonNums[sortedSeasonNums.length - 1] || 0;

            // ── existing DB seasons: check for new aired episodes ──
            for (const sn of sortedSeasonNums) {
              const seasonRows = col.seasons.get(sn)!;
              const dbMax = Math.max(...seasonRows.map((r) => r.episode_number || 0));
              const seasonTitle = seasonTitleFromRows(seasonRows, col.title, sn);
              const templateRow =
                seasonRows.find((r) => r.episode_number === dbMax) || seasonRows[0];

              let media: SyncMedia | null = chain[sn - 1] || null;
              if (!media) {
                // fallback: search "<title> season N" directly
                try {
                  const fb = await anilistFetch(SYNC_SEARCH_QUERY, {
                    search: `${col.title} season ${sn}`,
                  });
                  media = pickBest(`${col.title} season ${sn}`, fb?.Page?.media || []);
                } catch {
                  media = null;
                }
              }

              const seasonInfo: SeasonSyncInfo = {
                seasonNumber: sn,
                seasonTitle,
                dbEpisodes: seasonRows.length,
                airedEpisodes: dbMax,
                isNewSeason: false,
                newEpisodes: [],
              };

              if (!media) {
                seasonInfo.reason = "AniList par matching season nahi mila.";
                info.seasons.push(seasonInfo);
                continue;
              }

              seasonInfo.anilistId = media.id;
              seasonInfo.malId = media.idMal;
              seasonInfo.anilistStatus = media.status;
              seasonInfo.totalExpected = media.episodes || undefined;

              const { aired, known } = airedCount(media);
              seasonInfo.airedEpisodes = known ? aired : dbMax;
              if (!known || aired <= dbMax) {
                info.seasons.push(seasonInfo);
                continue;
              }

              const targetMax = Math.min(aired, media.episodes || aired, dbMax + maxPerSeason);
              const newEpNums: number[] = [];
              for (let e = dbMax + 1; e <= targetMax; e++) newEpNums.push(e);
              if (newEpNums.length === 0) {
                info.seasons.push(seasonInfo);
                continue;
              }

              // Jikan metadata for the new episodes
              let epMeta = new Map<number, JikanEp>();
              if (media.idMal) {
                epMeta = await jikanEpisodesUpTo(media.idMal, targetMax);
              }

              const cover =
                media.coverImage?.extraLarge || media.coverImage?.large || templateRow.image;
              for (const epNum of newEpNums) {
                const meta = epMeta.get(epNum);
                const epTitle = meta?.title || `Episode ${epNum}`;
                const image = meta?.images?.jpg?.image_url || cover;
                allNewRows.push({
                  title: `${seasonTitle} - ${epTitle}`,
                  description: (meta?.synopsis || "").slice(0, 1000),
                  image,
                  backdrop: templateRow.backdrop || templateRow.image,
                  thumbnailUrl: image,
                  year: media.seasonYear || media.startDate?.year || templateRow.year,
                  rating: templateRow.rating || "TV-14",
                  duration: templateRow.duration || "24m",
                  genre: templateRow.genre?.length ? templateRow.genre : ["Anime"],
                  match: templateRow.match_score ?? 95,
                  cast: templateRow.cast_members || undefined,
                  creator: templateRow.creator || undefined,
                  embedUrl: buildEmbed(col.template!.template, col.template!.imdbId, sn, epNum),
                  embedPlatform: templateRow.embed_platform || col.template!.provider,
                  playlistId,
                  playlistTitle: col.title,
                  episodeNumber: epNum,
                  seasonNumber: sn,
                });
                seasonInfo.newEpisodes.push(allNewRows[allNewRows.length - 1]);
              }
              info.seasons.push(seasonInfo);
            }

            // ── brand-new seasons not in DB yet (sequels that started airing) ──
            for (let ci = maxDbSeason; ci < chain.length; ci++) {
              const media = chain[ci];
              const { aired, known } = airedCount(media);
              if (!known || aired < 1) continue;
              const newSeasonNumber = ci + 1;
              const seasonTitle = bestTitle(media.title);

              const seasonInfo: SeasonSyncInfo = {
                seasonNumber: newSeasonNumber,
                seasonTitle,
                anilistId: media.id,
                malId: media.idMal,
                anilistStatus: media.status,
                dbEpisodes: 0,
                airedEpisodes: aired,
                totalExpected: media.episodes || undefined,
                isNewSeason: true,
                newEpisodes: [],
              };

              const targetMax = Math.min(aired, media.episodes || aired, maxPerSeason);
              let epMeta = new Map<number, JikanEp>();
              if (media.idMal) epMeta = await jikanEpisodesUpTo(media.idMal, targetMax);

              // inherit common fields from last episode of last known season
              const lastSeasonRows =
                col.seasons.get(sortedSeasonNums[sortedSeasonNums.length - 1]) || [];
              const templateRow = lastSeasonRows[lastSeasonRows.length - 1];
              const cover =
                media.coverImage?.extraLarge || media.coverImage?.large || templateRow?.image || "";

              for (let epNum = 1; epNum <= targetMax; epNum++) {
                const meta = epMeta.get(epNum);
                const epTitle = meta?.title || `Episode ${epNum}`;
                const image = meta?.images?.jpg?.image_url || cover;
                allNewRows.push({
                  title: `${seasonTitle} - ${epTitle}`,
                  description: (meta?.synopsis || "").slice(0, 1000),
                  image,
                  backdrop: media.bannerImage || image,
                  thumbnailUrl: image,
                  year: media.seasonYear || media.startDate?.year || new Date().getFullYear(),
                  rating: templateRow?.rating || "TV-14",
                  duration: templateRow?.duration || "24m",
                  genre: templateRow?.genre?.length ? templateRow.genre : ["Anime"],
                  match: templateRow?.match_score ?? 95,
                  cast: templateRow?.cast_members || undefined,
                  creator: templateRow?.creator || undefined,
                  embedUrl: buildEmbed(
                    col.template!.template,
                    col.template!.imdbId,
                    newSeasonNumber,
                    epNum,
                  ),
                  embedPlatform: templateRow?.embed_platform || col.template!.provider,
                  playlistId,
                  playlistTitle: col.title,
                  episodeNumber: epNum,
                  seasonNumber: newSeasonNumber,
                });
                seasonInfo.newEpisodes.push(allNewRows[allNewRows.length - 1]);
              }
              info.seasons.push(seasonInfo);
            }

            resultCollections.push(info);
          }

          return Response.json(
            {
              ok: true,
              checkedAt: new Date().toISOString(),
              collections: resultCollections,
              totalNewEpisodes: allNewRows.length,
              movies: allNewRows,
            },
            { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } },
          );
        } catch (err: unknown) {
          console.error("[anime-sync] error", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "Sync failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
