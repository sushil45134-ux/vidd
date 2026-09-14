/**
 * End-to-end test with MOCKED Supabase/API responses — verifies the full
 * client data path of a production build without external network:
 *   - library loads (1050 rows → 2 pages, page 2 must use light columns)
 *   - cards render as real cards (not "Coming Soon")
 *   - planned row matches by title; only unknown titles stay "Coming Soon"
 *   - modal opens fast
 *   - failure path: movies fetch aborts → retry banner, NO Coming Soon wall
 */
import { chromium } from "playwright";
import sparticuz from "@sparticuz/chromium";

const url = process.argv[2] || "http://localhost:4173";

const FULL_COLS =
  "id,title,description,image,backdrop,thumbnail_url,year,rating,duration,genre,match_score,cast_members,creator,video_url,youtube_id,embed_url,embed_platform,playlist_id,playlist_title,episode_number,season_number,is_collection,source_type,created_at";
const LIGHT_COLS = FULL_COLS.replace("description,", "").replace("cast_members,", "");

const LONG_DESC =
  "An epic test series description used to simulate the heavy free-text column. ".repeat(8);
const TOTAL = 1050;
function makeRows(from, to, withText) {
  const rows = [];
  for (let id = to; id >= from; id--) {
    const featured = id === TOTAL; // newest row matches the planned title
    rows.push({
      id,
      title: featured ? "Demon Slayer: Kimetsu no Yaiba" : `Test Movie ${id}`,
      description: withText ? LONG_DESC : null,
      image: null,
      backdrop: null,
      thumbnail_url: null,
      year: 2024,
      rating: "TV-14",
      duration: "24 min",
      genre: featured ? ["anime", "action"] : id % 2 ? ["anime"] : ["cartoon"],
      match_score: 95,
      cast_members: withText ? ["Voice A", "Voice B"] : null,
      creator: null,
      video_url: null,
      youtube_id: `vid${String(id).padStart(7, "0")}`,
      embed_url: null,
      embed_platform: null,
      playlist_id: null,
      playlist_title: null,
      episode_number: null,
      season_number: null,
      is_collection: false,
      source_type: id % 2 ? "synced" : "uploaded",
      created_at: new Date(Date.now() - id * 60000).toISOString(),
    });
  }
  return rows;
}

const movieSelects = [];
async function handleMovies(route) {
  const u = new URL(route.request().url());
  movieSelects.push(u.searchParams.get("select") || "");
  // supabase-js sends paging as offset/limit query params (no Range header).
  const from = Number(u.searchParams.get("offset") || "0");
  const limit = Number(u.searchParams.get("limit") || "1000");
  const last = Math.min(from + limit, TOTAL);
  const withText = u.searchParams.get("select")?.includes("description") ?? false;
  const body = makeRows(from + 1, Math.max(last, from + 1), withText);
  const headers = { "content-type": "application/json" };
  const prefer = route.request().headers()["prefer"] || "";
  if (prefer.includes("count")) headers["content-range"] = `0-${TOTAL - 1}/${TOTAL}`;
  await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
}

async function handleConfig(route) {
  await route.fulfill({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      brand_prefix: "vid",
      brand_suffix: "",
      hero_badge: "⭐ FEATURED",
      hero_title: "",
      hero_description: "",
      hero_overlay_visible: true,
      rows: [],
      custom_rows: [
        {
          id: "row-planned",
          title: "🔥 Wishlist Row",
          titleSize: "lg",
          visible: true,
          movieIds: [],
          plannedTitles: ["Demon Slayer: Kimetsu no Yaiba", "Totally Missing Show XYZ"],
          section: "home",
        },
      ],
      updated_at: new Date().toISOString(),
    }),
  });
}

async function runScenario(failMovies) {
  const browser = await chromium.launch({
    executablePath: await sparticuz.executablePath(),
    args: [...sparticuz.args, "--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 160)));

  await page.route("**/rest/v1/movies**", async (route) => {
    if (failMovies) return route.abort("connectionfailed");
    return handleMovies(route);
  });
  await page.route("**/rest/v1/site_config**", handleConfig);
  for (const t of ["hero_banners", "collection_covers"]) {
    await page.route(`**/rest/v1/${t}**`, (r) =>
      r.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" }),
    );
  }
  await page.route("**/api/auth**", (r) =>
    r.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"isAdmin":false}',
    }),
  );
  await page.route("**/api/anime**", (r) =>
    r.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "seed",
        total: 1,
        episodes: [
          {
            videoId: "dQw4w9WgXcQ",
            title: "[Hindi Dub] Mock Anime - Episode 01 | Mock",
            seriesName: "Mock Anime",
            episodeNumber: 1,
            seasonNumber: 1,
            thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          },
        ],
      }),
    }),
  );

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  let dataMs = null;
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".movie-card").length >= 1 ||
        /retry/i.test(document.body?.innerText || ""),
      null,
      { timeout: 25000 },
    );
    dataMs = Date.now() - t0;
  } catch {}

  const state = await page.evaluate(() => ({
    heroTitle: document.querySelector("h1")?.textContent?.trim()?.slice(0, 50) || "(none)",
    cards: document.querySelectorAll(".movie-card").length,
    cardTitles: Array.from(document.querySelectorAll(".movie-card p")).map((p) =>
      p.textContent?.trim(),
    ),
    placeholderTitles: Array.from(document.querySelectorAll("[title*='coming soon']")).map((p) =>
      p.getAttribute("title"),
    ),
    comingSoon: Array.from(document.querySelectorAll("p, span")).filter((n) =>
      /^Coming Soon$/i.test(n.textContent?.trim() || ""),
    ).length,
    rowTitles: Array.from(document.querySelectorAll("h2"))
      .map((h) => h.textContent.trim())
      .slice(0, 6),
    retryBanner: !!Array.from(document.querySelectorAll("button")).find((b) =>
      /retry/i.test(b.textContent || ""),
    ),
  }));

  let modalMs = null;
  if (state.cards > 0 && !failMovies) {
    try {
      const c0 = Date.now();
      await page.locator(".movie-card").first().click();
      await page.waitForFunction(
        () =>
          !!document.querySelector(".fixed.inset-0") &&
          document.querySelector(".fixed.inset-0").textContent.length > 50,
        null,
        { timeout: 15000 },
      );
      modalMs = Date.now() - c0;
      // A light row (no description) must fill its synopsis in the modal.
    } catch (e) {
      consoleErrors.push("modal: " + String(e).slice(0, 120));
    }
  }
  await context.close();
  await browser.close();
  return { failMovies, dataMs, state, modalMs, consoleErrors: consoleErrors.slice(0, 6) };
}

const ok = await runScenario(false);
const fail = await runScenario(true);
console.log(JSON.stringify({ ok, fail, movieSelects }, null, 2));
