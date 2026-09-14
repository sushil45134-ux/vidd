import type { Movie } from "../data";
import type { CustomRow } from "./customization";

/** One ordered slot inside a planned (wishlist) row. */
export type RowSlot = { kind: "movie"; movie: Movie } | { kind: "placeholder"; title: string };

/**
 * Normalize for title matching: case, punctuation, ×/x, extra spaces.
 * All apostrophe variants (straight, curly, fullwidth…) are stripped so
 * "Journey's" (typed) and "Journey’s" (AniList) normalize identically.
 * Accents are folded too, so "Pokémon" and "Pokemon" are the same.
 */
export function normalizeTitle(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[×✕]/g, "x")
    .replace(/[\u0027\u0060\u00b4\u2018\u2019\u201a\u201b\u02bb\u02bc\u02bd\u055a\uff07]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateNames(movie: Movie): string[] {
  const names: (string | undefined)[] = [movie.title, movie.playlistTitle];
  movie.episodes?.forEach((ep) => {
    names.push(ep.title, ep.playlistTitle);
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const norm = normalizeTitle(n || "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** Drop "season 3" / "part 2" style qualifiers for fallback matching. */
function stripQualifier(norm: string): string {
  return norm
    .replace(/\b(season|s|part|cour)\s*\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alphabetize words so "Shippuden Naruto" equals "Naruto Shippuden". */
function sortedTokens(norm: string): string {
  return norm.split(" ").filter(Boolean).sort().join(" ");
}

/** Leading word subsets ("demon slayer" from "demon slayer kimetsu…"). */
function leadingSubsets(norm: string): string[] {
  const words = norm.split(" ").filter(Boolean);
  const out: string[] = [];
  for (let k = 1; k < words.length; k++) {
    const s = words.slice(0, k).join(" ");
    if (s.length >= 6) out.push(s);
  }
  return out;
}

/**
 * Similarity 0..1 via optimal string alignment (Levenshtein + adjacent
 * transposition), so one typo — wrong, missing, extra or swapped letter —
 * costs exactly 1. Returns 0 when the length gap alone rules a match out.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const maxDist = Math.floor(maxLen * 0.15);
  if (Math.abs(a.length - b.length) > maxDist) return 0;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_row, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        best = Math.min(best, d[i - 2][j - 2] + 1);
      }
      d[i][j] = best;
    }
  }
  const dist = d[m][n];
  return dist > maxDist ? 0 : 1 - dist / maxLen;
}

function matchScore(planned: string, name: string): number {
  if (!planned || !name) return 0;
  if (name === planned) return 3;
  if (name.startsWith(planned)) return 2;
  if (planned.length >= 3 && name.includes(planned)) return 1.5;
  // "Demon Slayer — Season 3" still finds the base entry.
  const ps = stripQualifier(planned);
  const ns = stripQualifier(name);
  if (ps && ns && (ps !== planned || ns !== name)) {
    if (ns === ps) return 1.25;
    if (ns.startsWith(ps) || ps.startsWith(ns)) return 1;
    if (ps.length >= 3 && ns.includes(ps)) return 0.9;
  }
  if (planned.length >= 6 && name.length >= 6) {
    // Word-order differences: "Shippuden Naruto" finds "Naruto Shippuden".
    if (sortedTokens(name) === sortedTokens(planned)) return 1.4;
    // Small typos on the full title ("Narruto", "One Peice"). Outranks a bare
    // substring below, so "Naruto Shippduen" picks Shippuden over plain Naruto.
    if (similarity(planned, name) >= 0.85) return 0.8;
  }
  // Planned title merely contains the library name ("One Piece Film Red").
  if (name.length >= 3 && planned.includes(name)) return 0.75;
  // Last resort: typos inside a leading portion ("Demom Slayer" vs
  // "Demon Slayer: Kimetsu no Yaiba"). Strict on purpose — long titles only,
  // so short lookalikes like Naruto/Boruto never cross-match.
  if (planned.length >= 6 && name.length >= 6) {
    const pst = sortedTokens(planned);
    const nst = sortedTokens(name);
    const pForms = Array.from(new Set([pst, ...leadingSubsets(planned), ...leadingSubsets(pst)]));
    const nForms = Array.from(new Set([nst, ...leadingSubsets(name), ...leadingSubsets(nst)]));
    for (const pf of pForms) {
      for (const nf of nForms) {
        if (similarity(pf, nf) >= 0.85) return 0.5;
      }
    }
  }
  return 0;
}

/** Best library match for one planned title (null = show a placeholder). */
export function matchPlannedTitle(
  plannedTitle: string,
  items: Movie[],
  excludeIds?: Set<number>,
): Movie | null {
  const planned = normalizeTitle(plannedTitle);
  if (!planned) return null;
  let best: Movie | null = null;
  let bestScore = 0;
  for (const movie of items) {
    if (excludeIds?.has(movie.id)) continue;
    for (const name of candidateNames(movie)) {
      const score = matchScore(planned, name);
      if (score > bestScore) {
        bestScore = score;
        best = movie;
      }
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Resolve a wishlist into ordered slots. Every title becomes either its
 * matched movie or a "Coming Soon" placeholder — so the row keeps its shape
 * and fills in automatically as titles get added to the library.
 */
export function resolvePlannedSlots(plannedTitles: string[], items: Movie[]): RowSlot[] {
  const used = new Set<number>();
  const seenTitles = new Set<string>();
  const slots: RowSlot[] = [];
  for (const raw of plannedTitles) {
    const title = (raw || "").trim();
    if (!title) continue;
    const norm = normalizeTitle(title);
    if (!norm || seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    const movie = matchPlannedTitle(title, items, used);
    if (movie) {
      used.add(movie.id);
      slots.push({ kind: "movie", movie });
    } else {
      slots.push({ kind: "placeholder", title });
    }
  }
  return slots;
}

/**
 * IDs claimed by visible custom rows (manual picks AND planned matches,
 * from every section): auto grids must hide these so a placed title shows
 * only in its row.
 */
export function collectPlacedIds(
  rows: CustomRow[] | undefined,
  resolve: (row: CustomRow) => RowSlot[],
): Set<number> {
  const ids = new Set<number>();
  (rows || []).forEach((row) => {
    if (!row.visible) return;
    resolve(row).forEach((slot) => {
      if (slot.kind !== "movie") return;
      ids.add(slot.movie.id);
      slot.movie.episodes?.forEach((e) => ids.add(e.id));
    });
  });
  return ids;
}

/**
 * Parse the admin textarea (one title per line) into a clean list. Leading
 * bullets / numbering ("1. One Piece", "- Naruto") are stripped so pasted
 * lists work as-is; blanks and duplicates are dropped.
 */
export function parsePlannedTitles(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of (text || "").split("\n")) {
    const title = line
      .trim()
      .replace(/^(?:\d+[.)]\s*|[•\-*]\s*)+/, "")
      .trim();
    if (!title) continue;
    const norm = normalizeTitle(title);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(title);
  }
  return out;
}
