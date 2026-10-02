#!/usr/bin/env node
/**
 * Nxsha Anime-Movies Embed
 * ========================
 * Movies section ke saare anime films ko Nxsha (nxsha.space) ke TMDB-backed
 * movie player se re-embed karta hai aur unke liye proper rows banata hai.
 *
 * Kya hota hai:
 *   1. movies table ke standalone anime films (Your Name, Suzume, Ghibli,
 *      JJK 0, Reze Arc, …) ka embed_url Nxsha movie embed se replace —
 *      titles/years bhi TMDB-correct ho jaate hain. Posters untouched.
 *   2. site_config.custom_rows me "movies" section ke purane rows
 *      (POPULAR / TOP RATED / ROMANCE / Studio Ghibli) hata kar naye rows:
 *      MAKOTO SHINKAI · STUDIO GHIBLI · BLOCKBUSTER ANIME · HEARTWARMING
 *      FAMILY. "EMOTIONAL MOVIES" aur "WATCH AGAIN" rows bilkul untouched.
 *   3. Koi 3D/western-cartoon movie embed NAHI hoti (user request).
 *
 * Safe by default: bina APPLY=1 ke sirf plan print hota hai.
 * APPLY=1 + SUPABASE_SERVICE_ROLE_KEY ke saath hi likhta hai.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yjakihgnxntjfjvarxmt.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const APPLY = /^(1|true)$/i.test(process.env.APPLY || "");

if (APPLY && !SERVICE_KEY) throw new Error("APPLY=1 ke liye SUPABASE_SERVICE_ROLE_KEY required hai");
const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function db(path, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
          ...headers,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Nxsha movie embed — Hindi default, app-ad disabled, par server locked
 *  nahi (agar kisi film me Hindi track na ho to player dusre servers de). */
const embed = (tmdbId) => `https://nxsha.space/embed/movie/${tmdbId}?lang=hi&disable_app_ad=true`;

/**
 * Library ke anime films → Nxsha TMDB ids (sab nxsha.space/search se verified).
 * NOTE: EMOTIONAL MOVIES row ke films (743, 677, 676) aur WATCH AGAIN ke
 * films (33, 34, 35, 775, 979, 3629, 13009) jaan-boojh kar list me NAHI hain.
 */
const MOVIES = [
  { id: 980,   tmdb: 372058,  title: "Your Name",                        year: 2016 },
  { id: 981,   tmdb: 916224,  title: "Suzume",                           year: 2022 },
  { id: 19,    tmdb: 568160,  title: "Weathering with You",              year: 2019 },
  { id: 741,   tmdb: 38142,   title: "5 Centimeters per Second",         year: 2007 },
  { id: 675,   tmdb: 198375,  title: "The Garden of Words",              year: 2013 },
  { id: 13011, tmdb: 513347,  title: "Flavors of Youth",                 year: 2018 },
  { id: 983,   tmdb: 129,     title: "Spirited Away",                    year: 2001 },
  { id: 984,   tmdb: 4935,    title: "Howl's Moving Castle",             year: 2004 },
  { id: 985,   tmdb: 128,     title: "Princess Mononoke",                year: 1997 },
  { id: 7896,  tmdb: 8392,    title: "My Neighbor Totoro",               year: 1988 },
  { id: 7895,  tmdb: 508883,  title: "The Boy and the Heron",            year: 2023 },
  { id: 982,   tmdb: 810693,  title: "Jujutsu Kaisen 0",                 year: 2021 },
  { id: 13010, tmdb: 1218925, title: "Chainsaw Man - The Movie: Reze Arc", year: 2025 },
  { id: 13012, tmdb: 110420,  title: "Wolf Children",                    year: 2012 },
];

const byId = new Map(MOVIES.map((m) => [m.id, m]));
const ref = (id) => {
  const m = byId.get(id);
  if (!m) throw new Error(`Unknown movie id ${id}`);
  return `embed:${embed(m.tmdb)}`;
};

/** Demon Slayer Infinity Castle (13009) WATCH AGAIN ka film hai — embed
 *  untouched, bas BLOCKBUSTER row me bhi dikhana hai (existing ref se). */
const DEMON_SLAYER_ID = 13009;
const DEMON_SLAYER_REF =
  "embed:https://streams.iqsmartgames.com/embed/movie/tt32820897?key=e11a7debaaa4f5d25b671706ffe4d2acb56efbd4";

/** Movies-section rows jo kabhi nahi chhede jaate. */
const KEEP_ROW_IDS = new Set([
  "row_1789236299647", // EMOTIONAL MOVIES
  "row_1789537983253", // WATCH AGAIN
]);

const row = (id, title, ids, extraRefs = {}) => ({
  id,
  title,
  isLarge: false,
  section: "movies",
  visible: true,
  movieIds: ids,
  movieRefs: ids.map((mid) => extraRefs[mid] || ref(mid)),
  titleSize: "lg",
});

const NEW_ROWS = [
  row("row_nxsha_shinkai", "MAKOTO SHINKAI MOVIES", [980, 981, 19, 741, 675, 13011]),
  row("row_nxsha_ghibli", "STUDIO GHIBLI MOVIES", [983, 984, 985, 7896, 7895]),
  row(
    "row_nxsha_blockbuster",
    "BLOCKBUSTER ANIME MOVIES",
    [DEMON_SLAYER_ID, 982, 13010],
    { [DEMON_SLAYER_ID]: DEMON_SLAYER_REF },
  ),
  row("row_nxsha_family", "HEARTWARMING FAMILY MOVIES", [13012, 7896, 983, 13011]),
];

async function main() {
  console.log(`Nxsha anime-movies embed · mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // ---------- 1) movies table: Nxsha embeds ----------
  for (const m of MOVIES) {
    const patch = {
      title: m.title,
      year: m.year,
      embed_url: embed(m.tmdb),
      embed_platform: "Nxsha",
      youtube_id: null,
      video_url: null,
      updated_at: new Date().toISOString(),
    };
    console.log(`movie ${m.id}: "${m.title}" (${m.year}) -> ${patch.embed_url}`);
    if (APPLY) {
      const updated = await db(`movies?id=eq.${m.id}&select=id`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!updated || updated.length !== 1) throw new Error(`movie ${m.id} update failed`);
    }
  }

  // ---------- 2) site_config.custom_rows ----------
  const cfgRows = await db("site_config?select=custom_rows&id=eq.1");
  const current = cfgRows?.[0]?.custom_rows;
  if (!Array.isArray(current)) throw new Error("site_config.custom_rows missing");

  const next = [];
  let inserted = false;
  const removed = [];
  for (const r of current) {
    const isMoviesRow = (r.section || "home") === "movies";
    const isOurRow = String(r.id || "").startsWith("row_nxsha_");
    if (!isMoviesRow || KEEP_ROW_IDS.has(r.id)) {
      if (!isOurRow) next.push(r);
      continue;
    }
    // movies-section row being replaced — pehli jagah par naye rows daalo
    removed.push(`${r.id} "${(r.title || "").trim()}"`);
    if (!inserted) {
      next.push(...NEW_ROWS);
      inserted = true;
    }
  }
  if (!inserted) {
    // koi purana movies row nahi mila — EMOTIONAL se pehle ya end me daalo
    const at = next.findIndex((r) => r.id === "row_1789236299647");
    if (at >= 0) next.splice(at, 0, ...NEW_ROWS);
    else next.push(...NEW_ROWS);
  }

  console.log(`rows removed (${removed.length}): ${removed.join(" · ") || "none"}`);
  console.log(`rows added (${NEW_ROWS.length}): ${NEW_ROWS.map((r) => `"${r.title}"`).join(" · ")}`);
  console.log(
    `rows kept: EMOTIONAL MOVIES · WATCH AGAIN · ${current.filter((r) => (r.section || "home") !== "movies").length} non-movies rows`,
  );

  if (APPLY) {
    await db("site_config?id=eq.1", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ custom_rows: next, updated_at: new Date().toISOString() }),
    });
    // verify
    const check = await db("site_config?select=custom_rows&id=eq.1");
    const titles = (check?.[0]?.custom_rows || [])
      .filter((r) => (r.section || "home") === "movies")
      .map((r) => r.title.trim());
    console.log(`verify movies-section rows: ${titles.join(" | ")}`);
  }

  console.log(APPLY ? "DONE — live site updated." : "DRY-RUN complete (APPLY=1 to write).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
