import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/anime-auto — No API key needed
 * Uses AniList GraphQL (public) + Jikan API (public) to fetch anime metadata
 * 
 * Query params:
 *   title  = anime name (required) e.g. "Naruto"
 *   imdbId = optional tt... id, just echoed back for client convenience
 * 
 * Returns:
 *   {
 *     mainTitle, mainCover, mainBanner, description,
 *     seasons: [{ seasonNumber, title, coverImage, bannerImage, year, episodes: [{episodeNumber, title, image, synopsis}] }]
 *   }
 */

interface AniListTitle {
  romaji: string;
  english?: string;
  native?: string;
}

interface AniListCover {
  extraLarge: string;
  large: string;
  color?: string;
}

interface AniListMedia {
  id: number;
  idMal?: number;
  title: AniListTitle;
  description?: string;
  coverImage: AniListCover;
  bannerImage?: string;
  format?: string;
  episodes?: number;
  duration?: number;
  season?: string;
  seasonYear?: number;
  averageScore?: number;
  genres: string[];
  studios?: { nodes: { name: string }[] };
  startDate?: { year?: number; month?: number; day?: number };
  type?: string;
  relations?: {
    edges: { relationType: string; version?: number }[];
    nodes: AniListMedia[];
  };
  streamingEpisodes?: { title: string; thumbnail: string; url: string; site: string }[];
}

interface JikanEpisode {
  mal_id: number;
  title: string;
  title_japanese?: string;
  title_romanji?: string;
  aired?: string;
  synopsis?: string;
  filler: boolean;
  recap: boolean;
  images?: { jpg?: { image_url?: string } };
  duration?: number;
}

const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_BASE = "https://api.jikan.moe/v4";

const SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      title { romaji english native }
      description
      coverImage { extraLarge large color }
      bannerImage
      format
      episodes
      duration
      season
      seasonYear
      averageScore
      genres
      studios { nodes { name } }
      startDate { year month day }
    }
  }
}
`;

const MEDIA_DETAILS_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title { romaji english native }
    description
    coverImage { extraLarge large color }
    bannerImage
    format
    episodes
    duration
    season
    seasonYear
    averageScore
    genres
    studios { nodes { name } }
    startDate { year month day }
    streamingEpisodes { title thumbnail url site }
    relations {
      edges { relationType version }
      nodes {
        id
        idMal
        title { romaji english native }
        coverImage { extraLarge large }
        bannerImage
        format
        episodes
        season
        seasonYear
        averageScore
        genres
        studios { nodes { name } }
        startDate { year month day }
        type
      }
    }
  }
}
`;

function stripHtml(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 1000);
}

function bestTitle(t: AniListTitle): string {
  return t.english || t.romaji || t.native || "Unknown Anime";
}

async function anilistFetch(query: string, variables: any): Promise<any> {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`AniList ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`AniList error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

async function jikanSearch(title: string): Promise<AniListMedia[]> {
  try {
    const res = await fetch(`${JIKAN_BASE}/anime?q=${encodeURIComponent(title)}&limit=5&order_by=popularity&sort=desc&sfw=true`, {
      headers: { "User-Agent": "vid-anime/1.0" },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const data = json.data || [];
    // Convert Jikan format to AniList-like for compatibility
    return data.map((m: any) => ({
      id: m.mal_id + 1000000, // fake anilist id
      idMal: m.mal_id,
      title: { romaji: m.title, english: m.title_english || m.title, native: m.title_japanese },
      description: m.synopsis,
      coverImage: { extraLarge: m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || "", large: m.images?.jpg?.image_url || "" },
      bannerImage: m.images?.jpg?.large_image_url || "",
      format: m.type,
      episodes: m.episodes,
      duration: m.duration ? parseInt(m.duration) || 24 : 24,
      season: m.season,
      seasonYear: m.year,
      averageScore: m.score ? Math.round(m.score * 10) : undefined,
      genres: m.genres?.map((g: any) => g.name) || [],
      studios: { nodes: m.studios?.map((s: any) => ({ name: s.name })) || [] },
      startDate: { year: m.year },
    }));
  } catch {
    return [];
  }
}

async function jikanEpisodes(malId: number): Promise<JikanEpisode[]> {
  const episodes: JikanEpisode[] = [];
  let page = 1;
  let hasNext = true;
  let tries = 0;
  while (hasNext && page <= 20 && tries < 25) {
    tries++;
    try {
      // Respect Jikan rate limit: 3 req/sec
      if (page > 1) await new Promise((r) => setTimeout(r, 400));
      const res = await fetch(`${JIKAN_BASE}/anime/${malId}/episodes?page=${page}`, {
        headers: { "User-Agent": "vid-anime/1.0" },
      });
      if (res.status === 429) {
        // rate limited, wait 1 sec
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      if (!res.ok) break;
      const json = await res.json();
      const data: JikanEpisode[] = json.data || [];
      if (data.length === 0) break;
      episodes.push(...data);
      hasNext = json.pagination?.has_next_page === true;
      page++;
    } catch {
      break;
    }
  }
  return episodes;
}

function buildSeasonsChain(main: AniListMedia): AniListMedia[] {
  const all: AniListMedia[] = [main];
  const relNodes = main.relations?.nodes || [];
  const relEdges = main.relations?.edges || [];

  // Collect related TV series that are sequels/prequels or share similar title
  const relatedTV: { media: AniListMedia; rel: string; year: number }[] = [];

  for (let i = 0; i < relNodes.length; i++) {
    const node = relNodes[i];
    const edge = relEdges[i];
    const relType = edge?.relationType || "";
    // Only consider anime sequels, prequels, and side stories that are TV format
    if (!node) continue;
    if (node.type && node.type !== "ANIME") continue;
    const fmt = (node as any).format;
    if (fmt && !["TV", "TV_SHORT", "ONA", "OVA"].includes(fmt)) {
      // Still allow if it's TV-like
      if (fmt !== "TV" && relType !== "SEQUEL" && relType !== "PREQUEL") continue;
    }
    const year = node.startDate?.year || node.seasonYear || 9999;
    relatedTV.push({ media: node, rel: relType, year });
  }

  // Sort chronologically to build season order
  relatedTV.sort((a, b) => a.year - b.year);

  // Find prequels to put before main, sequels after
  const prequels = relatedTV.filter((r) => r.rel === "PREQUEL").sort((a, b) => a.year - b.year);
  const sequels = relatedTV.filter((r) => r.rel === "SEQUEL").sort((a, b) => a.year - b.year);
  const others = relatedTV.filter((r) => r.rel !== "PREQUEL" && r.rel !== "SEQUEL");

  // Build chain: prequels + main + sequels + others (if no sequels)
  const chain: AniListMedia[] = [];
  // Add prequels first
  for (const p of prequels) chain.push(p.media);
  chain.push(main);
  for (const s of sequels) chain.push(s.media);

  // If chain only has main and we have other related TV with same base name, add them sorted
  if (chain.length === 1 && others.length > 0) {
    // Filter others that look like same franchise (same first word or contains)
    const baseWord = bestTitle(main.title).split(" ")[0].toLowerCase();
    const similar = others.filter((o) => {
      const t = bestTitle(o.media.title).toLowerCase();
      return t.includes(baseWord) || baseWord.includes(t.split(" ")[0]);
    });
    for (const o of similar.sort((a, b) => a.year - b.year)) {
      if (!chain.find((c) => c.id === o.media.id)) chain.push(o.media);
    }
  }

  // Deduplicate
  const seen = new Set<number>();
  const deduped: AniListMedia[] = [];
  for (const m of chain) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    deduped.push(m);
  }

  return deduped.slice(0, 10); // max 10 seasons
}

export const Route = createFileRoute("/api/anime-auto")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const title = (url.searchParams.get("title") || "").trim();
        const imdbId = (url.searchParams.get("imdbId") || "").trim() || undefined;

        if (!title) {
          return Response.json({ error: "title query param required, e.g. ?title=Naruto" }, { status: 400 });
        }

        try {
          // 1. Search AniList
          let searchResults: AniListMedia[] = [];
          try {
            const data = await anilistFetch(SEARCH_QUERY, { search: title, perPage: 10 });
            searchResults = data?.Page?.media || [];
          } catch (e) {
            console.warn("[anime-auto] AniList search failed", e);
          }

          // Fallback to Jikan if AniList empty
          if (searchResults.length === 0) {
            searchResults = await jikanSearch(title);
            if (searchResults.length === 0) {
              return Response.json({ error: `No anime found for "${title}"` }, { status: 404 });
            }
          }

          // Pick best: first with idMal, else first
          let mainSearch = searchResults.find((m) => !!m.idMal) || searchResults[0];

          // If mainSearch is from Jikan fake id, we don't have relations, handle separately
          let mainDetailed: AniListMedia | null = null;
          if (mainSearch.id < 1000000) {
            // Real AniList id, fetch details
            try {
              const detailData = await anilistFetch(MEDIA_DETAILS_QUERY, { id: mainSearch.id });
              mainDetailed = detailData?.Media || null;
            } catch (e) {
              console.warn("[anime-auto] AniList details failed", e);
              mainDetailed = mainSearch;
            }
          } else {
            mainDetailed = mainSearch;
          }

          if (!mainDetailed) mainDetailed = mainSearch;

          const seasonsChain = mainDetailed.id < 1000000 ? buildSeasonsChain(mainDetailed) : [mainDetailed];

          // 2. For each season, fetch Jikan episodes if possible
          const seasons: any[] = [];
          let totalEpisodes = 0;

          for (let idx = 0; idx < seasonsChain.length; idx++) {
            const media = seasonsChain[idx];
            const seasonNumber = idx + 1;
            const cover = media.coverImage?.extraLarge || media.coverImage?.large || "";
            const banner = media.bannerImage || cover;
            const studios = media.studios?.nodes?.map((s) => s.name) || [];
            const episodesCount = media.episodes || 0;

            let jikanEps: JikanEpisode[] = [];
            if (media.idMal) {
              jikanEps = await jikanEpisodes(media.idMal);
            }

            // If Jikan episodes empty, try streamingEpisodes from AniList as fallback
            let episodes: any[] = [];

            if (jikanEps.length > 0) {
              episodes = jikanEps.map((je) => ({
                episodeNumber: je.mal_id,
                title: je.title || `Episode ${je.mal_id}`,
                titleJapanese: je.title_japanese,
                synopsis: je.synopsis ? stripHtml(je.synopsis) : "",
                aired: je.aired,
                image: je.images?.jpg?.image_url || cover,
                filler: je.filler,
                recap: je.recap,
              }));
            } else if (media.streamingEpisodes && media.streamingEpisodes.length > 0) {
              episodes = media.streamingEpisodes.slice(0, episodesCount || 50).map((se, i) => ({
                episodeNumber: i + 1,
                title: se.title || `Episode ${i + 1}`,
                synopsis: "",
                aired: "",
                image: se.thumbnail || cover,
              }));
            } else {
              // Generate placeholder episodes based on count
              const count = episodesCount || 12;
              for (let e = 1; e <= count; e++) {
                episodes.push({
                  episodeNumber: e,
                  title: `Episode ${e}`,
                  synopsis: "",
                  aired: "",
                  image: cover,
                });
              }
            }

            totalEpisodes += episodes.length;

            seasons.push({
              seasonNumber,
              title: bestTitle(media.title),
              titleEnglish: media.title.english,
              titleNative: media.title.native,
              description: stripHtml(media.description),
              coverImage: cover,
              bannerImage: banner,
              year: media.seasonYear || media.startDate?.year,
              season: media.season,
              episodesCount: episodes.length || episodesCount,
              averageScore: media.averageScore,
              genres: media.genres || [],
              studios,
              anilistId: media.id,
              malId: media.idMal,
              format: media.format,
              episodes,
            });
          }

          const mainTitle = bestTitle(mainDetailed.title);
          const result = {
            query: title,
            imdbId,
            mainTitle,
            mainCover: mainDetailed.coverImage?.extraLarge || mainDetailed.coverImage?.large || seasons[0]?.coverImage || "",
            mainBanner: mainDetailed.bannerImage || seasons[0]?.bannerImage || "",
            description: stripHtml(mainDetailed.description),
            genres: mainDetailed.genres || [],
            totalSeasons: seasons.length,
            totalEpisodes,
            seasons,
            source: "anilist+jikan" as const,
          };

          return Response.json(result, {
            headers: { "cache-control": "public, max-age=3600" },
          });
        } catch (err: any) {
          console.error("[anime-auto] error", err);
          return Response.json({ error: err?.message || "Failed to fetch anime" }, { status: 500 });
        }
      },
    },
  },
});
