#!/usr/bin/env node
/**
 * Reconcile every anime collection with Nxsha's TMDB-backed catalogue.
 *
 * Safe by default: without APPLY=1 this only prints a migration plan.
 * With APPLY=1 it first inserts the canonical nxsha-tv-{tmdbId} rows, verifies
 * them, and only then removes legacy/wrong rows. Season 0 is intentionally
 * excluded. Subsequent runs only add missing aired episodes and remove keys
 * that no longer exist in Nxsha/TMDB, so created_at is not reset every day.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yjakihgnxntjfjvarxmt.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const API_BASE = (process.env.NXSHA_API_BASE || "https://vidd-zeta.vercel.app").replace(/\/$/, "");
const APPLY = /^(1|true)$/i.test(process.env.APPLY || "");
const LIMIT = Math.max(0, Number(process.env.LIMIT || 0));
const TARGET_TMDB_IDS = new Set(
  String(process.env.TARGET_TMDB_IDS || "").split(",").map((id) => id.trim()).filter(Boolean),
);
const DELETE_OBSOLETE = /^(1|true)$/i.test(process.env.DELETE_OBSOLETE || "");
const NXSHA_TEMPLATE =
  "https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true";

if (APPLY && !SERVICE_KEY) throw new Error("APPLY=1 ke liye SUPABASE_SERVICE_ROLE_KEY required hai");
const key = SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function db(path, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: { ...headers, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function readAnime() {
  const rows = [];
  const select = "id,title,description,image,backdrop,thumbnail_url,year,rating,duration,genre,match_score,cast_members,creator,embed_url,embed_platform,playlist_id,playlist_title,episode_number,season_number,source_type";
  for (let offset = 0; ; offset += 1000) {
    const page = await db(`movies?select=${encodeURIComponent(select)}&genre=cs.${encodeURIComponent('{"Anime"}')}&order=created_at.desc&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.filter((row) => row.playlist_id && row.season_number != null && row.episode_number != null);
}

const normal = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\b(season|episode|s\d+e\d+)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
function titleMatch(a, b) {
  const x = normal(a), y = normal(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const words = x.split(" ").filter((w) => w.length > 2);
  return words.length > 0 && words.filter((w) => y.split(" ").includes(w)).length / words.length >= 0.65;
}
const epKey = (row) => `${Number(row.season_number)}:${Number(row.episode_number)}`;

async function fetchCatalogue(title) {
  const url = `${API_BASE}/api/nxsha-fetch?q=${encodeURIComponent(title)}`; // specials omitted by design
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Nxsha API ${res.status}`);
  return data;
}

function makeRows(result, sample, sourceType) {
  const genre = Array.from(new Set(["Anime", ...(result.genres || [])]));
  return result.seasons.flatMap((season) => season.episodes.map((episode) => {
    const image = episode.image || result.poster || sample.image;
    const label = episode.title && !/^Episode \d+$/i.test(episode.title)
      ? `S${season.seasonNumber}E${episode.episodeNumber} — ${episode.title}`
      : `S${season.seasonNumber}E${episode.episodeNumber}`;
    return {
      title: `${result.title} ${label}`,
      description: result.overview || sample.description || "",
      image,
      backdrop: result.backdrop || image,
      thumbnail_url: image,
      year: episode.aired ? Number(episode.aired.slice(0, 4)) : result.year || sample.year,
      rating: sample.rating || "TV-14",
      duration: episode.runtime || sample.duration || "24m",
      genre,
      match_score: sample.match_score || 95,
      cast_members: sample.cast_members || null,
      creator: "Nxsha Direct",
      embed_url: NXSHA_TEMPLATE.replace("{id}", result.tmdbId).replace("{s}", season.seasonNumber).replace("{e}", episode.episodeNumber),
      embed_platform: "Nxsha",
      playlist_id: `nxsha-tv-${result.tmdbId}`,
      playlist_title: result.title,
      episode_number: episode.episodeNumber,
      season_number: season.seasonNumber,
      is_collection: false,
      source_type: sourceType === "uploaded" ? "uploaded" : "synced",
    };
  }));
}

async function readPlaylist(playlistId, select = "id,playlist_id,season_number,episode_number,genre") {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db(
      `movies?select=${encodeURIComponent(select)}&playlist_id=eq.${encodeURIComponent(playlistId)}&order=id.asc&limit=1000&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function insertRows(rows) {
  for (let i = 0; i < rows.length; i += 250) {
    await db("movies", { method: "POST", body: JSON.stringify(rows.slice(i, i + 250)), headers: { Prefer: "return=minimal" } });
  }
}
async function deleteIds(ids) {
  for (let i = 0; i < ids.length; i += 200) {
    await db(`movies?id=in.(${ids.slice(i, i + 200).join(",")})`, { method: "DELETE" });
  }
}

// Recovery for the first migration attempt, where title search selected the
// similarly named One Piece live-action show and Hunter × Hunter (1999).
// Their original playlist IDs prove the intended Nxsha/TMDB entries. This is
// idempotent and can be removed after the repair has run successfully.
async function repairKnownWrongRemaps() {
  if (!APPLY) return;
  const repairs = [
    { wrongId: "111110", correctId: "37854" },
    { wrongId: "45952", correctId: "46298" },
  ];
  for (const repair of repairs) {
    const wrongPlaylist = `nxsha-tv-${repair.wrongId}`;
    const wrong = await readPlaylist(wrongPlaylist, "id,genre");
    const ids = wrong.filter((row) => (row.genre || []).includes("Anime")).map((row) => row.id);
    if (!ids.length) continue;
    const result = await fetchCatalogue(repair.correctId);
    const correctPlaylist = `nxsha-tv-${repair.correctId}`;
    const existing = await readPlaylist(correctPlaylist, "id,season_number,episode_number");
    const existingKeys = new Set(existing.map(epKey));
    const sample = { title: result.title, genre: ["Anime"], source_type: "synced", rating: "TV-14", match_score: 95 };
    const missing = makeRows(result, sample, "synced").filter((row) => !existingKeys.has(epKey(row)));
    await insertRows(missing);
    await deleteIds(ids);
    console.log(`RECOVER ${wrongPlaylist} -> ${correctPlaylist}: +${missing.length} -${ids.length}`);
  }
}

await repairKnownWrongRemaps();
const allRows = await readAnime();
const groups = new Map();
for (const row of allRows) {
  const list = groups.get(row.playlist_id) || [];
  list.push(row);
  groups.set(row.playlist_id, list);
}
let collections = [...groups.entries()];
if (TARGET_TMDB_IDS.size) {
  collections = collections.filter(([playlist]) => {
    const id = playlist.match(/^nxsha-tv-(\d+)$/)?.[1];
    return !!id && TARGET_TMDB_IDS.has(id);
  });
  // A requested show may not exist in the database yet. Seed a synthetic
  // collection so its complete Nxsha catalogue is still created.
  for (const id of TARGET_TMDB_IDS) {
    if (!collections.some(([playlist]) => playlist === `nxsha-tv-${id}`)) {
      collections.push([
        `nxsha-tv-${id}`,
        [{ playlist_id: `nxsha-tv-${id}`, playlist_title: id, title: id, genre: ["Anime"], source_type: "synced", rating: "TV-14", match_score: 95 }],
      ]);
    }
  }
}
if (LIMIT) collections = collections.slice(0, LIMIT);
console.log(`Nxsha reconcile: ${collections.length} anime collections · mode=${APPLY ? "APPLY" : "DRY RUN"} · API=${API_BASE}`);

const summary = { planned: 0, migrated: 0, inserted: 0, deleted: 0, skipped: 0, failed: 0 };
for (const [oldPlaylist, oldRows] of collections) {
  const oldTitle = oldRows[0].playlist_title || oldRows[0].title;
  try {
    // Canonical playlists already contain the exact TMDB ID. Never title-search
    // those: similarly named remakes (One Piece, Hunter × Hunter) can otherwise
    // resolve to a different Nxsha show.
    const canonicalId = oldPlaylist.match(/^nxsha-tv-(\d+)$/)?.[1];
    const result = await fetchCatalogue(canonicalId || oldTitle);
    if (!canonicalId && !titleMatch(oldTitle, result.title)) {
      console.log(`SKIP title mismatch: "${oldTitle}" -> "${result.title}" (#${result.tmdbId})`);
      summary.skipped++;
      continue;
    }
    const canonical = `nxsha-tv-${result.tmdbId}`;
    const desired = makeRows(result, oldRows[0], oldRows[0].source_type);
    if (!desired.length) { console.log(`SKIP no aired episodes: ${oldTitle}`); summary.skipped++; continue; }
    // Read this target fresh on every iteration: multiple legacy playlist IDs
    // can resolve to one Nxsha show during the same migration run.
    const canonicalExisting = await readPlaylist(
      canonical,
      "id,playlist_id,season_number,episode_number",
    );
    const desiredKeys = new Set(desired.map(epKey));
    const existingKeys = new Set();
    const duplicateCanonical = [];
    for (const row of canonicalExisting) {
      const key = epKey(row);
      if (existingKeys.has(key)) duplicateCanonical.push(row);
      else existingKeys.add(key);
    }
    const missing = desired.filter((row) => !existingKeys.has(epKey(row)));
    // Remote season pages can fail halfway and produce a partial catalogue.
    // Deletion therefore requires an explicit, targeted repair opt-in.
    const obsoleteCanonical = DELETE_OBSOLETE
      ? canonicalExisting.filter((row) => !desiredKeys.has(epKey(row)))
      : [];
    const legacy = oldPlaylist === canonical ? [] : oldRows;
    console.log(`${oldTitle}: ${oldPlaylist} -> ${canonical} · Nxsha ${desired.length} · +${missing.length} · -${legacy.length + obsoleteCanonical.length + duplicateCanonical.length}`);
    summary.planned++;
    if (!APPLY) continue;

    // Insert first: a failed remote/API write can never destroy the old collection.
    // Supabase only returns after every insert chunk succeeds; unlike a
    // follow-up select this also works for 1000+ episode shows (PostgREST caps
    // normal select responses at 1000 rows).
    await insertRows(missing);
    const deleteList = Array.from(
      new Map([...legacy, ...obsoleteCanonical, ...duplicateCanonical].map((row) => [row.id, row])).values(),
    );
    await deleteIds(deleteList.map((row) => row.id));
    summary.migrated++;
    summary.inserted += missing.length;
    summary.deleted += deleteList.length;
  } catch (error) {
    summary.failed++;
    console.error(`FAIL ${oldTitle}: ${error instanceof Error ? error.message : error}`);
  }
  await sleep(350);
}
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
