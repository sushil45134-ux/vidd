#!/usr/bin/env node
/**
 * anime-sync.mjs — Fully automatic "New Episode" sync (cron-friendly).
 * =====================================================================
 * Ye script wahi kaam karti hai jo /api/anime-sync + admin button karte
 * hain, lekin bina kisi browser/admin login ke:
 *
 *   1. Supabase se saari auto-fetched anime collections padhti hai
 *      (playlist_id like 'anime-auto-%').
 *   2. AniList se check karti hai kitne episodes AB TAK AIR ho chuke hain
 *      (nextAiringEpisode / status / episodes) — naye seasons bhi (sequels).
 *   3. Jikan se naye episodes ka title/synopsis/thumbnail leti hai.
 *   4. Same Nxsha/NHD embed template se nayi rows Supabase me INSERT karti
 *      hai (service_role key se, isliye SUPABASE_SERVICE_ROLE_KEY chahiye).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/anime-sync.mjs
 *   DRY_RUN=1 SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/anime-sync.mjs
 *
 * GitHub Actions me har 6 ghante chalta hai (.github/workflows/anime-episode-sync.yml).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yjakihgnxntjfjvarxmt.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const MAX_PER_SEASON = Math.min(Math.max(1, Number(process.env.MAX_PER_SEASON || 50)), 100);

const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_BASE = "https://api.jikan.moe/v4";

const SYNC_FIELDS = `
  id idMal status episodes format seasonYear
  startDate { year }
  title { romaji english native }
  coverImage { extraLarge large }
  bannerImage
  nextAiringEpisode { episode airingAt }
`;
const SEARCH_QUERY = `query ($search: String) { Page(perPage: 10) { media(search: $search, type: ANIME, sort: POPULARITY_DESC) { ${SYNC_FIELDS} } } }`;
const DETAILS_QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) { ${SYNC_FIELDS} relations { edges { relationType } nodes { ${SYNC_FIELDS} type } } } }`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAnilistCall = 0;
async function anilist(query, variables) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const gap = 700 - (Date.now() - lastAnilistCall);
    if (gap > 0) await sleep(gap);
    lastAnilistCall = Date.now();
    const res = await fetch(ANILIST_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }) });
    if (res.status === 429) { if (attempt === 3) throw new Error("AniList 429"); await sleep(20000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`AniList ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(`AniList: ${JSON.stringify(json.errors).slice(0, 200)}`);
    return json.data;
  }
}
async function anilistBatchSearch(titles) {
  const out = [];
  for (let start = 0; start < titles.length; start += 10) {
    const chunk = titles.slice(start, start + 10), vars = {}, fields = [];
    chunk.forEach((title, i) => { vars[`q${i}`] = title; fields.push(`q${i}: Page(perPage: 10) { media(search: $q${i}, type: ANIME, sort: POPULARITY_DESC) { ${SYNC_FIELDS} } }`); });
    const defs = chunk.map((_, i) => `$q${i}: String`).join(", ");
    const data = await anilist(`query (${defs}) { ${fields.join(" ")} }`, vars);
    out.push(...chunk.map((_, i) => data?.[`q${i}`]?.media || []));
  }
  return out;
}
async function anilistBatchDetails(ids) {
  const out = Array(ids.length).fill(null);
  for (let start = 0; start < ids.length; start += 10) {
    const chunk = ids.slice(start, start + 10), vars = {}, fields = [], positions = [];
    chunk.forEach((id, i) => { if (id == null) return; vars[`i${i}`] = id; positions.push([i, start + i]); fields.push(`i${i}: Media(id: $i${i}, type: ANIME) { ${SYNC_FIELDS} relations { edges { relationType } nodes { ${SYNC_FIELDS} type } } }`); });
    if (!fields.length) continue;
    const defs = positions.map(([i]) => `$i${i}: Int`).join(", ");
    const data = await anilist(`query (${defs}) { ${fields.join(" ")} }`, vars);
    positions.forEach(([i, pos]) => { out[pos] = data?.[`i${i}`] || null; });
  }
  return out;
}

const bestTitle = (t) => t.english || t.romaji || t.native || "Unknown";

function scoreTitleMatch(q, c) {
  q = q.toLowerCase().trim();
  c = c.toLowerCase().trim();
  if (c === q) return 100;
  if (c.startsWith(q)) return 90;
  if (c.includes(q)) return 80;
  if (q.includes(c)) return 70;
  const qw = q.split(/[\s:]+/).filter((w) => w.length > 2);
  const cw = c.split(/[\s:]+/).filter((w) => w.length > 2);
  const common = qw.filter((w) => cw.includes(w)).length;
  return qw.length ? Math.round((common / qw.length) * 60) : 0;
}

function pickBest(query, results) {
  if (!results.length) return null;
  const scored = results
    .map((m) => {
      let best = 0;
      for (const v of [m.title.english, m.title.romaji, m.title.native]) {
        if (!v) continue;
        const s = scoreTitleMatch(query, v);
        if (s > best) best = s;
      }
      if (m.idMal) best += 5;
      if (m.status === "RELEASING") best += 3;
      return { m, best };
    })
    .sort((a, b) => b.best - a.best);
  return scored[0]?.m || results[0];
}

function buildChain(main) {
  const edges = main.relations?.edges || [];
  const nodes = main.relations?.nodes || [];
  const related = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rel = edges[i]?.relationType || "";
    if (!node || (node.type && node.type !== "ANIME")) continue;
    if (node.format && !["TV", "TV_SHORT", "ONA", "OVA"].includes(node.format)) continue;
    if (rel !== "PREQUEL" && rel !== "SEQUEL") continue;
    related.push({ media: node, rel, year: node.startDate?.year || node.seasonYear || 9999 });
  }
  const pre = related.filter((r) => r.rel === "PREQUEL").sort((a, b) => a.year - b.year);
  const seq = related.filter((r) => r.rel === "SEQUEL").sort((a, b) => a.year - b.year);
  const chain = [...pre.map((r) => r.media), main, ...seq.map((r) => r.media)];
  const seen = new Set();
  return chain.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).slice(0, 10);
}

function airedCount(media) {
  if (media.nextAiringEpisode) return { aired: media.nextAiringEpisode.episode - 1, known: true };
  if (media.status === "FINISHED") return { aired: media.episodes || 0, known: true };
  return { aired: 0, known: false };
}

async function jikanEpisodesUpTo(malId, upTo) {
  const out = new Map();
  const maxPage = Math.min(Math.max(1, Math.ceil(upTo / 100) + 1), 12);
  for (let page = 1; page <= maxPage; page++) {
    try {
      if (page > 1) await sleep(450);
      let res = await fetch(`${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`, {
        headers: { "User-Agent": "vid-anime-sync/1.0" },
      });
      if (res.status === 429) {
        await sleep(2000);
        res = await fetch(`${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`, {
          headers: { "User-Agent": "vid-anime-sync/1.0" },
        });
      }
      if (!res.ok) break;
      const json = await res.json();
      const data = json.data || [];
      if (!data.length) break;
      for (const ep of data) out.set(ep.mal_id, ep);
      if (out.has(upTo)) break;
      if (json.pagination?.has_next_page !== true) break;
    } catch {
      break;
    }
  }
  return out;
}

async function readCollections() {
  const rows = [];
  const columns =
    "id,title,year,rating,duration,genre,match_score,cast_members,creator,image,backdrop,embed_url,embed_platform,playlist_id,playlist_title,season_number,episode_number";
  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/movies`);
    url.searchParams.set("select", columns);
    url.searchParams.set("playlist_id", "like.anime-auto-*");
    url.searchParams.set("season_number", "not.is.null");
    url.searchParams.set("episode_number", "not.is.null");
    url.searchParams.set("order", "playlist_id,season_number,episode_number");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(rows.length));
    const res = await fetch(url.toString(), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase read failed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function parseEmbedTemplate(embedUrl) {
  const m = embedUrl.match(/\/tv\/([^/?]+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  const imdbId = decodeURIComponent(m[1]);
  const template = embedUrl.replace(`/tv/${m[1]}/${m[2]}/${m[3]}`, "/tv/{id}/{s}/{e}");
  const lower = embedUrl.toLowerCase();
  const provider = lower.includes("nxsha") ? "Nxsha" : lower.includes("nhdapi") ? "NHD" : "Embed";
  return { imdbId, template, provider };
}

const buildEmbed = (template, id, s, e) =>
  template
    .replace(/\{id\}/g, encodeURIComponent(id))
    .replace(/\{s\}/g, String(s))
    .replace(/\{e\}/g, String(e));

function seasonTitleFromRows(rows, playlistTitle, seasonNumber) {
  const first = rows[0];
  if (first?.title?.includes(" - ")) return first.title.split(" - ")[0].trim();
  if (first?.title && /episode\s+\d+$/i.test(first.title)) {
    return first.title.replace(/\s*episode\s+\d+$/i, "").trim() || playlistTitle;
  }
  return seasonNumber > 1 ? `${playlistTitle} Season ${seasonNumber}` : playlistTitle;
}

async function insertRows(rows) {
  if (!rows.length) return 0;
  const payload = rows.map((r) => ({
    title: r.title,
    description: r.description,
    image: r.image,
    backdrop: r.backdrop ?? null,
    year: r.year,
    rating: r.rating,
    duration: r.duration,
    genre: r.genre,
    match_score: r.match,
    cast_members: r.cast ?? null,
    creator: r.creator ?? null,
    thumbnail_url: r.thumbnailUrl ?? null,
    embed_url: r.embedUrl,
    embed_platform: r.embedPlatform ?? null,
    playlist_id: r.playlistId,
    playlist_title: r.playlistTitle,
    episode_number: r.episodeNumber,
    season_number: r.seasonNumber,
    is_collection: false,
    source_type: "synced",
  }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/movies`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Supabase insert failed ${res.status}: ${await res.text()}`);
  return rows.length;
}

/* ─────────────────────────────── main ─────────────────────────────── */

async function main() {
  if (!DRY_RUN && !SERVICE_KEY) {
    console.error(
      "❌ SUPABASE_SERVICE_ROLE_KEY missing.\n" +
        "   Supabase Dashboard → Settings → API → service_role (secret) key copy karke\n" +
        "   GitHub repo Settings → Secrets → Actions me SUPABASE_SERVICE_ROLE_KEY add karo.\n" +
        "   (Sirf dekhna hai kya add hota: DRY_RUN=1 lagao)",
    );
    process.exit(1);
  }

  console.log(`🔍 Reading anime collections from Supabase...${DRY_RUN ? " (DRY RUN)" : ""}`);
  const rows = await readCollections();
  if (!rows.length) {
    console.log("No anime collections found (playlist_id like anime-auto-%). Nothing to do.");
    return;
  }

  // group by playlist
  const collections = new Map();
  for (const row of rows) {
    let col = collections.get(row.playlist_id);
    if (!col) {
      col = { title: row.playlist_title || row.playlist_id, seasons: new Map(), template: null };
      collections.set(row.playlist_id, col);
    }
    const sn = row.season_number || 1;
    if (!col.seasons.has(sn)) col.seasons.set(sn, []);
    col.seasons.get(sn).push(row);
    if (!col.template && row.embed_url) col.template = parseEmbedTemplate(row.embed_url);
  }

  console.log(`Found ${collections.size} collection(s). Checking AniList...\n`);
  const collectionList = [...collections.values()];
  const searchResults = await anilistBatchSearch(collectionList.map((c) => c.title));
  const picked = searchResults.map((r, i) => pickBest(collectionList[i].title, r));
  const detailed = await anilistBatchDetails(picked.map((m) => m?.id));
  const prefetched = new Map(collectionList.map((c, i) => [c, detailed[i] || picked[i]]));
  let totalAdded = 0;
  for (const [playlistId, col] of collections) {
    if (!col.template) {
      console.log(`⏭  ${col.title}: no IMDb-style embed, skipped`);
      continue;
    }

    let chain = [];
    const prefetchedMedia = prefetched.get(col);
    if (prefetchedMedia) chain = buildChain(prefetchedMedia);
    if (!chain.length) {
      console.log(`⏭  ${col.title}: not found on AniList`);
      continue;
    }

    const seasonNums = [...col.seasons.keys()].sort((a, b) => a - b);
    const maxDbSeason = seasonNums[seasonNums.length - 1] || 0;
    const newRows = [];
    const summary = [];

    // existing seasons → new aired episodes
    for (const sn of seasonNums) {
      const srows = col.seasons.get(sn);
      const dbMax = Math.max(...srows.map((r) => r.episode_number || 0));
      const seasonTitle = seasonTitleFromRows(srows, col.title, sn);
      const templateRow = srows.find((r) => r.episode_number === dbMax) || srows[0];

      let media = chain[sn - 1] || null;
      if (!media) {
        try {
          const fb = await anilist(SEARCH_QUERY, { search: `${col.title} season ${sn}` });
          media = pickBest(`${col.title} season ${sn}`, fb?.Page?.media || []);
        } catch {
          media = null;
        }
      }
      if (!media) continue;
      const { aired, known } = airedCount(media);
      if (!known || aired <= dbMax) continue;

      const targetMax = Math.min(aired, media.episodes || aired, dbMax + MAX_PER_SEASON);
      let epMeta = new Map();
      if (media.idMal) epMeta = await jikanEpisodesUpTo(media.idMal, targetMax);
      const cover = media.coverImage?.extraLarge || media.coverImage?.large || templateRow.image;

      let n = 0;
      for (let e = dbMax + 1; e <= targetMax; e++) {
        const meta = epMeta.get(e);
        const image = meta?.images?.jpg?.image_url || cover;
        newRows.push({
          title: `${seasonTitle} - ${meta?.title || `Episode ${e}`}`,
          description: (meta?.synopsis || "").slice(0, 1000),
          image,
          thumbnailUrl: image,
          backdrop: templateRow.backdrop || templateRow.image,
          year: media.seasonYear || media.startDate?.year || templateRow.year,
          rating: templateRow.rating || "TV-14",
          duration: templateRow.duration || "24m",
          genre: templateRow.genre?.length ? templateRow.genre : ["Anime"],
          match: templateRow.match_score ?? 95,
          cast: templateRow.cast_members || undefined,
          creator: templateRow.creator || undefined,
          embedUrl: buildEmbed(col.template.template, col.template.imdbId, sn, e),
          embedPlatform: templateRow.embed_platform || col.template.provider,
          playlistId,
          playlistTitle: col.title,
          episodeNumber: e,
          seasonNumber: sn,
        });
        n++;
      }
      if (n) summary.push(`S${sn}: ${dbMax} → ${targetMax} (+${n})`);
    }

    // brand-new seasons (sequels that started airing)
    for (let ci = maxDbSeason; ci < chain.length; ci++) {
      const media = chain[ci];
      const { aired, known } = airedCount(media);
      if (!known || aired < 1) continue;
      const sn = ci + 1;
      const seasonTitle = bestTitle(media.title);
      const targetMax = Math.min(aired, media.episodes || aired, MAX_PER_SEASON);
      let epMeta = new Map();
      if (media.idMal) epMeta = await jikanEpisodesUpTo(media.idMal, targetMax);
      const lastRows = col.seasons.get(seasonNums[seasonNums.length - 1]) || [];
      const templateRow = lastRows[lastRows.length - 1];
      const cover =
        media.coverImage?.extraLarge || media.coverImage?.large || templateRow?.image || "";

      let n = 0;
      for (let e = 1; e <= targetMax; e++) {
        const meta = epMeta.get(e);
        const image = meta?.images?.jpg?.image_url || cover;
        newRows.push({
          title: `${seasonTitle} - ${meta?.title || `Episode ${e}`}`,
          description: (meta?.synopsis || "").slice(0, 1000),
          image,
          thumbnailUrl: image,
          backdrop: media.bannerImage || image,
          year: media.seasonYear || media.startDate?.year || new Date().getFullYear(),
          rating: templateRow?.rating || "TV-14",
          duration: templateRow?.duration || "24m",
          genre: templateRow?.genre?.length ? templateRow.genre : ["Anime"],
          match: templateRow?.match_score ?? 95,
          cast: templateRow?.cast_members || undefined,
          creator: templateRow?.creator || undefined,
          embedUrl: buildEmbed(col.template.template, col.template.imdbId, sn, e),
          embedPlatform: templateRow?.embed_platform || col.template.provider,
          playlistId,
          playlistTitle: col.title,
          episodeNumber: e,
          seasonNumber: sn,
        });
        n++;
      }
      if (n) summary.push(`S${sn} NEW SEASON: +${n} aired`);
    }

    if (!newRows.length) {
      console.log(`✅ ${col.title}: up to date`);
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `👀 ${col.title}: would add ${newRows.length} episode(s) — ${summary.join(", ")}`,
      );
    } else {
      const added = await insertRows(newRows);
      totalAdded += added;
      console.log(`➕ ${col.title}: added ${added} episode(s) — ${summary.join(", ")}`);
    }
  }

  console.log(`\n${DRY_RUN ? "DRY RUN complete." : `Done. ${totalAdded} new episode(s) added.`}`);
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && /anime-sync\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("❌ anime-sync failed:", e);
    process.exit(1);
  });
}

export {
  parseEmbedTemplate,
  buildEmbed,
  airedCount,
  buildChain,
  pickBest,
  scoreTitleMatch,
  seasonTitleFromRows,
};
