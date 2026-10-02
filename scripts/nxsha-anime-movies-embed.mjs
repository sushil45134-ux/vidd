#!/usr/bin/env node
/**
 * Nxsha Anime-Movies Embed
 * ========================
 * Movies section ke saare anime films ko Nxsha (nxsha.space) ke TMDB-backed
 * movie player se embed karta hai aur unke liye proper franchise rows banata
 * hai. "EMOTIONAL MOVIES" aur "WATCH AGAIN" rows bilkul untouched rehte hain,
 * aur koi 3D/western-cartoon movie embed NAHI hoti (user request).
 *
 * Do kaam:
 *   1. Pehle se library me maujood anime films ka embed_url Nxsha se replace
 *      (titles/years TMDB-correct; posters untouched).
 *   2. Naye anime films insert (agar pehle se nahi hain) aur unke liye
 *      specific rows: DEMON SLAYER / ONE PIECE / DRAGON BALL / NARUTO /
 *      MY HERO ACADEMIA / HOSODA / ROMANCE / SPORTS / NEW — WATCH AGAIN ke
 *      niche append hote hain.
 *
 * Safe by default: bina APPLY=1 ke sirf plan print hota hai.
 * APPLY=1 + SUPABASE_SERVICE_ROLE_KEY ke saath hi likhta hai. Idempotent —
 * dubara chalane par duplicate insert nahi hota (embed_url se match).
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
const poster = (p) => `https://image.tmdb.org/t/p/w500${p}`;

/**
 * Library ke existing anime films → Nxsha TMDB ids (nxsha.space/search se verified).
 * NOTE: EMOTIONAL MOVIES row ke films (743, 677, 676) aur WATCH AGAIN ke
 * baki films (33, 34, 35, 775, 979, 3629) jaan-boojh kar list me NAHI hain.
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
  // Title same rakha hai taaki WATCH AGAIN row ka plannedTitle match karta rahe.
  { id: 13009, tmdb: 1311031, title: "Demon Slayer: Kimetsu No Yaiba Infinity Castle", year: 2025 },
  // SPY x FAMILY CODE: White — YouTube se Nxsha par (anime tab me bhi hai).
  { id: 515,   tmdb: 1062807, title: "SPY x FAMILY CODE: White",         year: 2023 },
];

/**
 * Naye anime films (sab nxsha.space/search se verified TMDB ids + posters).
 * key se rows inhe reference karte hain; insert idempotent hai (embed_url).
 */
const NEW_MOVIES = [
  // Demon Slayer
  { key: "mugen-train", tmdb: 635302, title: "Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train", year: 2020, img: "/h8Rb9gBr48ODIwYUttZNYeMWeUU.jpg", genre: ["Action", "Fantasy"], duration: "1h 57m", desc: "Tanjiro aur Hashira Rengoku Mugen Train par ek khatarnak demon ka saamna karte hain." },
  // One Piece
  { key: "op-red", tmdb: 900667, title: "One Piece Film: Red", year: 2022, img: "/8ibfhe4P7rhmn3lrPhOZzIJHA2B.jpg", genre: ["Action", "Adventure"], duration: "1h 55m", desc: "Duniya ki sabse mashhoor singer Uta ka raaz — Shanks ki beti ki kahani." },
  { key: "op-stampede", tmdb: 568012, title: "One Piece: Stampede", year: 2019, img: "/4E2lyUGLEr3yH4q6kJxPkQUhX7n.jpg", genre: ["Action", "Adventure"], duration: "1h 41m", desc: "Pirates Festival me duniya bhar ke pirates Gol D. Roger ke khazane ke liye bhidte hain." },
  { key: "op-gold", tmdb: 374205, title: "One Piece Film: GOLD", year: 2016, img: "/9PgiOFTLZXP7emlwcIt0yRasJ9h.jpg", genre: ["Action", "Adventure"], duration: "2h 0m", desc: "Gran Tesoro ke golden city me Straw Hats ka sabse bada casino heist." },
  // Dragon Ball
  { key: "db-broly", tmdb: 503314, title: "Dragon Ball Super: Broly", year: 2018, img: "/uMEgkyiPznZP5AiMSWAk2jsj5gC.jpg", genre: ["Action", "Fantasy"], duration: "1h 40m", desc: "Goku aur Vegeta ka saamna legendary Saiyan Broly se hota hai." },
  { key: "db-superhero", tmdb: 610150, title: "Dragon Ball Super: Super Hero", year: 2022, img: "/pi0iZOEHeA3ih4p1IwAG4x2DZNH.jpg", genre: ["Action", "Fantasy"], duration: "1h 40m", desc: "Red Ribbon Army wapas — Gohan aur Piccolo ki super hero jodi." },
  { key: "dbz-broly", tmdb: 34433, title: "Dragon Ball Z: Broly - The Legendary Super Saiyan", year: 1993, img: "/6iO8TJCyLI4BiPYOvdwzPV2bhoV.jpg", genre: ["Action", "Fantasy"], duration: "1h 12m", desc: "Legendary Super Saiyan Broly ki pehli tabahi." },
  // Naruto
  { key: "naruto-last", tmdb: 317442, title: "The Last: Naruto the Movie", year: 2014, img: "/bAQ8O5Uw6FedtlCbJTutenzPVKd.jpg", genre: ["Action", "Romance"], duration: "1h 52m", desc: "Naruto aur Hinata ki kahani — chaand girne se pehle duniya bachani hai." },
  { key: "boruto-movie", tmdb: 347201, title: "Boruto: Naruto the Movie", year: 2015, img: "/1k6iwC4KaPvTBt1JuaqXy3noZRY.jpg", genre: ["Action", "Adventure"], duration: "1h 35m", desc: "Boruto apne pita Hokage Naruto ki chhaya se nikal kar apna raasta banata hai." },
  { key: "road-to-ninja", tmdb: 118406, title: "Road to Ninja: Naruto the Movie", year: 2012, img: "/xLal6fXNtiJN6Zw6qk21xAtdOeN.jpg", genre: ["Action", "Adventure"], duration: "1h 49m", desc: "Madara ke genjutsu me Naruto aur Sakura ek alternate duniya me phas jaate hain." },
  // My Hero Academia
  { key: "mha-two-heroes", tmdb: 505262, title: "My Hero Academia: Two Heroes", year: 2018, img: "/hC4nTxdhXqFWzgqynGvvXVMiMNp.jpg", genre: ["Action", "Adventure"], duration: "1h 36m", desc: "I-Island par Deku aur All Might villains ka saamna karte hain." },
  { key: "mha-heroes-rising", tmdb: 592350, title: "My Hero Academia: Heroes Rising", year: 2019, img: "/kpWsIkfXrnQ1pmR79qAHHq7DPxc.jpg", genre: ["Action", "Adventure"], duration: "1h 44m", desc: "Class 1-A ek door island par Nine jaise mahashaktishali villain se ladti hai." },
  { key: "mha-whm", tmdb: 768744, title: "My Hero Academia: World Heroes' Mission", year: 2021, img: "/jzP5rPwwNqUGERlrUzKKljfyulf.jpg", genre: ["Action", "Adventure"], duration: "1h 44m", desc: "Humarise cult duniya ke quirks mitaane nikla hai — heroes ki global mission." },
  { key: "mha-next", tmdb: 1159311, title: "My Hero Academia: You're Next", year: 2024, img: "/tTrI6PwqzxkgO3dvQ7BEKXM7SYR.jpg", genre: ["Action", "Adventure"], duration: "1h 50m", desc: "All Might jaisa dikhne wala rahasyamay villain — Deku ki nayi jung." },
  // Mamoru Hosoda
  { key: "summer-wars", tmdb: 28874, title: "Summer Wars", year: 2009, img: "/fIFzH5mZOeh9G3UqDd6WdaN72UV.jpg", genre: ["Adventure", "Sci-Fi"], duration: "1h 54m", desc: "Virtual duniya OZ hack ho gayi — ek poora parivar milkar use bachata hai." },
  { key: "boy-beast", tmdb: 315465, title: "The Boy and the Beast", year: 2015, img: "/kRofx67xkbnJ6pAVcHdeMyBm4OM.jpg", genre: ["Adventure", "Fantasy"], duration: "1h 59m", desc: "Anath ladka beast warrior Kumatetsu ka shishya ban jaata hai." },
  { key: "mirai", tmdb: 475215, title: "Mirai", year: 2018, img: "/b9XvI4Nehzi0nXyNVD6DtT39P6l.jpg", genre: ["Adventure", "Fantasy"], duration: "1h 38m", desc: "Chhota Kun apni future se aayi behen Mirai ke saath waqt me safar karta hai." },
  { key: "belle", tmdb: 776305, title: "Belle", year: 2021, img: "/fYHOD4pxZQk4rsP2tQrZI5uBlZV.jpg", genre: ["Drama", "Sci-Fi"], duration: "2h 1m", desc: "Suzu virtual duniya U me singer Belle banti hai aur Dragon ka raaz kholti hai." },
  // Romance / Drama
  { key: "josee", tmdb: 652837, title: "Josee, the Tiger and the Fish", year: 2020, img: "/z1D8xi9x4uEhyFruo7uEHXUMD4K.jpg", genre: ["Romance", "Drama"], duration: "1h 38m", desc: "Tsuneo aur wheelchair par rehne wali Josee ki samundar jaisi gehri prem kahani." },
  { key: "whisker-away", tmdb: 667520, title: "A Whisker Away", year: 2020, img: "/6inkRM1XGBG5vRhclCPWfMenp7N.jpg", genre: ["Romance", "Fantasy"], duration: "1h 44m", desc: "Miyo billi bankar apne crush ke kareeb jaati hai — par insaan wapas banna mushkil hai." },
  { key: "hello-world", tmdb: 604605, title: "Hello World", year: 2019, img: "/vmizP4G4EWsxNf6PLOvGNaFJ89Y.jpg", genre: ["Romance", "Sci-Fi"], duration: "1h 37m", desc: "Future se aaya Naomi apne past self ko apni mohabbat bachane bhejta hai." },
  { key: "bubble", tmdb: 912598, title: "Bubble", year: 2022, img: "/wjgwIZyEgtgy9nIdz6C5uJNel2X.jpg", genre: ["Romance", "Sci-Fi"], duration: "1h 40m", desc: "Gravity-tooti Tokyo me parkour ladka Hibiki aur rahasyamay Uta ki kahani." },
  { key: "words-bubble", tmdb: 579741, title: "Words Bubble Up Like Soda Pop", year: 2021, img: "/ooISQS2rzVqgkt2aq5HNoz8n2sa.jpg", genre: ["Romance", "Drama"], duration: "1h 27m", desc: "Haiku likhne wala Cherry aur apni smile chhupane wali Smile ki summer love story." },
  { key: "girl-leapt", tmdb: 14069, title: "The Girl Who Leapt Through Time", year: 2006, img: "/fmK92C7HGu6sK0axItlQ0YsO9qR.jpg", genre: ["Romance", "Sci-Fi"], duration: "1h 38m", desc: "Makoto ko waqt me peeche kudne ki shakti milti hai — par har chhalang ki keemat hai." },
  // Sports
  { key: "slam-dunk", tmdb: 783675, title: "The First Slam Dunk", year: 2022, img: "/yq4tSiYvfGw150Ntq8NbsFZ12En.jpg", genre: ["Sports", "Drama"], duration: "2h 4m", desc: "Shohoku ka point guard Ryota Miyagi — national championship ka sabse bada match." },
  { key: "haikyu-dumpster", tmdb: 1012201, title: "HAIKYU!! The Dumpster Battle", year: 2024, img: "/ntRU0OA4etGGiMMmH1Yw0bnaMdW.jpg", genre: ["Sports", "Drama"], duration: "1h 25m", desc: "Karasuno vs Nekoma — kachra-gaadi ki ladai, nationals ka dream match." },
  { key: "bluelock-nagi", tmdb: 1104844, title: "BLUE LOCK THE MOVIE -EPISODE NAGI-", year: 2024, img: "/yZYZqT1f6rddhiSdjl8NVVCoZKE.jpg", genre: ["Sports", "Drama"], duration: "1h 31m", desc: "Genius striker Nagi Seishiro ki nazar se Blue Lock ki kahani." },
  // Shonen specials / new
  { key: "bc-wizard-king", tmdb: 812225, title: "Black Clover: Sword of the Wizard King", year: 2023, img: "/9YEGawvjaRgnyW6QVcUhFJPFDco.jpg", genre: ["Action", "Fantasy"], duration: "1h 50m", desc: "Pichhle Wizard Kings zinda ho gaye — Asta Clover Kingdom ke liye ladta hai." },
  { key: "renegade-immortal", tmdb: 1599191, title: "Renegade Immortal: Battle of the Immortal Slayer", year: 2026, img: "/cpgLuRAT8SW7YiZaBYUGZ43GiLL.jpg", genre: ["Action", "Fantasy"], duration: "1h 55m", desc: "Wang Lin ki immortal cultivation ki jung — Renegade Immortal ki movie." },
];

const byId = new Map(MOVIES.map((m) => [m.id, m]));
const byKey = new Map(NEW_MOVIES.map((m) => [m.key, m]));
/** key -> resolved DB id (insert/lookup ke baad bharta hai). */
const resolvedIds = new Map();

const refOf = (x) => {
  const m = typeof x === "number" ? byId.get(x) : byKey.get(x);
  if (!m) throw new Error(`Unknown movie ${x}`);
  return `embed:${embed(m.tmdb)}`;
};
const idOf = (x) => {
  if (typeof x === "number") return x;
  const id = resolvedIds.get(x);
  if (id == null) throw new Error(`Movie "${x}" ka DB id resolve nahi hua`);
  return id;
};

/** Movies-section rows jo kabhi nahi chhede jaate. */
const KEEP_ROW_IDS = new Set([
  "row_1789236299647", // EMOTIONAL MOVIES
  "row_1789537983253", // WATCH AGAIN
]);
const WATCH_AGAIN_ID = "row_1789537983253";
const EMOTIONAL_ID = "row_1789236299647";

const row = (id, title, members) => ({
  id,
  title,
  isLarge: false,
  section: "movies",
  visible: true,
  movieIds: members.map(idOf),
  movieRefs: members.map(refOf),
  titleSize: "lg",
});

/** EMOTIONAL se upar wale rows (purane removed rows ki jagah). */
const topRows = () => [
  row("row_nxsha_shinkai", "MAKOTO SHINKAI MOVIES", [980, 981, 19, 741, 675, 13011]),
  row("row_nxsha_ghibli", "STUDIO GHIBLI MOVIES", [983, 984, 985, 7896, 7895]),
  row("row_nxsha_blockbuster", "BLOCKBUSTER ANIME MOVIES", [13009, 982, 13010, "bc-wizard-king", "mugen-train"]),
  row("row_nxsha_family", "HEARTWARMING FAMILY MOVIES", [13012, 7896, 983, 13011]),
];

/** WATCH AGAIN ke niche append hone wale naye specific rows. */
const bottomRows = () => [
  row("row_nxsha_new", "NEW ANIME MOVIES", ["renegade-immortal", "mha-next", "bluelock-nagi", "haikyu-dumpster", 13009, 13010, 515]),
  row("row_nxsha_demonslayer", "DEMON SLAYER MOVIES", ["mugen-train", 13009]),
  row("row_nxsha_onepiece", "ONE PIECE MOVIES", ["op-red", "op-stampede", "op-gold"]),
  row("row_nxsha_dragonball", "DRAGON BALL MOVIES", ["db-broly", "db-superhero", "dbz-broly"]),
  row("row_nxsha_naruto", "NARUTO MOVIES", ["naruto-last", "boruto-movie", "road-to-ninja"]),
  row("row_nxsha_mha", "MY HERO ACADEMIA MOVIES", ["mha-two-heroes", "mha-heroes-rising", "mha-whm", "mha-next"]),
  row("row_nxsha_hosoda", "MAMORU HOSODA MOVIES", ["summer-wars", "boy-beast", 13012, "mirai", "belle"]),
  row("row_nxsha_romance", "ROMANCE ANIME MOVIES", ["josee", "whisker-away", "hello-world", "bubble", "words-bubble", "girl-leapt"]),
  row("row_nxsha_sports", "SPORTS ANIME MOVIES", ["slam-dunk", "haikyu-dumpster", "bluelock-nagi"]),
];

async function main() {
  console.log(`Nxsha anime-movies embed · mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // ---------- 1) existing movies: Nxsha embeds ----------
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

  // ---------- 2) new movies: insert-if-missing ----------
  let inserted = 0;
  let existing = 0;
  for (const m of NEW_MOVIES) {
    const url = embed(m.tmdb);
    const found = await db(`movies?select=id&embed_url=eq.${encodeURIComponent(url)}&limit=1`);
    if (found && found.length > 0) {
      resolvedIds.set(m.key, found[0].id);
      existing++;
      console.log(`exists ${found[0].id}: "${m.title}"`);
      continue;
    }
    console.log(`insert: "${m.title}" (${m.year}) -> ${url}`);
    if (APPLY) {
      const rows = await db(`movies`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          title: m.title,
          description: m.desc || "",
          image: poster(m.img),
          thumbnail_url: poster(m.img),
          year: m.year,
          duration: m.duration || "",
          genre: m.genre,
          creator: "Nxsha",
          embed_url: url,
          embed_platform: "Nxsha",
          source_type: "uploaded",
        }]),
      });
      if (!rows || rows.length !== 1) throw new Error(`insert failed: ${m.title}`);
      resolvedIds.set(m.key, rows[0].id);
      inserted++;
    } else {
      resolvedIds.set(m.key, -1); // dry-run placeholder
    }
  }
  console.log(`new movies: inserted=${inserted} already-present=${existing}`);

  // ---------- 3) site_config.custom_rows ----------
  const cfgRows = await db("site_config?select=custom_rows&id=eq.1");
  const current = cfgRows?.[0]?.custom_rows;
  if (!Array.isArray(current)) throw new Error("site_config.custom_rows missing");

  const TOP = topRows();
  const BOTTOM = bottomRows();

  const next = [];
  let placedTop = false;
  const removed = [];
  for (const r of current) {
    const isMoviesRow = (r.section || "home") === "movies";
    if (!isMoviesRow) {
      next.push(r);
      continue;
    }
    if (KEEP_ROW_IDS.has(r.id)) {
      // EMOTIONAL se pehle TOP rows (agar abhi tak nahi lage)
      if (r.id === EMOTIONAL_ID && !placedTop) {
        next.push(...TOP);
        placedTop = true;
      }
      next.push(r);
      // WATCH AGAIN ke turant baad BOTTOM rows
      if (r.id === WATCH_AGAIN_ID) next.push(...BOTTOM);
      continue;
    }
    removed.push(`${r.id} "${(r.title || "").trim()}"`);
    if (!placedTop) {
      next.push(...TOP);
      placedTop = true;
    }
  }
  if (!placedTop) next.push(...TOP);
  if (!next.some((r) => r.id === "row_nxsha_new")) next.push(...BOTTOM);

  console.log(`rows removed (${removed.length}): ${removed.join(" · ") || "none"}`);
  console.log(`rows top (${TOP.length}): ${TOP.map((r) => `"${r.title}"`).join(" · ")}`);
  console.log(`rows bottom (${BOTTOM.length}): ${BOTTOM.map((r) => `"${r.title}"`).join(" · ")}`);

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
