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
    .replace(/[\u00d7\u2715]/g, "x")
    .replace(/[\u0027\u0060\u00b4\u2018\u2019\u201a\u201b\u02bb\u02bc\u02bd\u055a\uff07]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  // Three rolling rows instead of a full (m+1)×(n+1) matrix — the same OSA
  // result with O(n) memory (the transposition term needs row i-2).
  const m = a.length;
  const n = b.length;
  let pp = new Array<number>(n + 1);
  let p = new Array<number>(n + 1);
  let c = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) p[j] = j;
  for (let i = 1; i <= m; i++) {
    c[0] = i;
    const ai = a.charCodeAt(i - 1);
    const aiPrev = i > 1 ? a.charCodeAt(i - 2) : -1;
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = p[j] + 1;
      const ins = c[j - 1] + 1;
      const sub = p[j - 1] + cost;
      let best = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && aiPrev === b.charCodeAt(j - 1)) {
        const transp = pp[j - 2] + 1;
        if (transp < best) best = transp;
      }
      c[j] = best;
    }
    const tmp = pp;
    pp = p;
    p = c;
    c = tmp;
  }
  const dist = p[n];
  return dist > maxDist ? 0 : 1 - dist / maxLen;
}

/**
 * Length-gap prefilter shared by the fuzzy loops: when the gap alone rules
 * a pair out, callers skip the similarity() call entirely (no function-call
 * or O(m×n) cost for the ~99% of library pairs that can't match).
 */
function lengthCompatible(aLen: number, bLen: number): boolean {
  const maxLen = aLen > bLen ? aLen : bLen;
  const gap = aLen > bLen ? aLen - bLen : bLen - aLen;
  return gap <= Math.floor(maxLen * 0.15);
}

// ──────────────────────────────────────────────────────────────────────────
// Indexed matching.
//
// The old code normalized every library title (plus every episode title of
// every collection) and ran Levenshtein matrices for EVERY planned title on
// EVERY library update — on a 4,000-title library with wishlist rows this was
// seconds of main-thread block during boot ("site ruk jata hai").
//
// Now the library is normalized ONCE per array identity (WeakMap cache) and
// each query runs cheap string comparisons first; the fuzzy pass only runs
// when nothing cheap scored ≥ 0.9 (fuzzy scores max out at 0.8, so skipping
// it can never change the winner). Matching behaviour is unchanged.
// ──────────────────────────────────────────────────────────────────────────

interface IndexedName {
  /** Normalized title. */
  n: string;
  /** stripQualifier(n) — precomputed, query-independent. */
  s: string;
  /** sortedTokens(n) — precomputed. */
  sorted: string;
  /** [sorted, ...leadingSubsets(n), ...leadingSubsets(sorted)] with lengths. */
  subsets: Array<{ t: string; len: number }>;
  len: number;
  hasDigit: boolean;
}

interface IndexedMovie {
  movie: Movie;
  names: IndexedName[];
}

export interface PlannedIndex {
  entries: IndexedMovie[];
  exact: Map<string, IndexedMovie[]>;
}

function indexName(raw: string | undefined, seen: Set<string>): IndexedName | null {
  const n = normalizeTitle(raw || "");
  if (!n || seen.has(n)) return null;
  seen.add(n);
  const sorted = sortedTokens(n);
  const subsetSeen = new Set<string>();
  const subsets: Array<{ t: string; len: number }> = [];
  for (const t of [sorted, ...leadingSubsets(n), ...leadingSubsets(sorted)]) {
    if (subsetSeen.has(t)) continue;
    subsetSeen.add(t);
    subsets.push({ t, len: t.length });
  }
  return { n, s: stripQualifier(n), sorted, subsets, len: n.length, hasDigit: /\d/.test(n) };
}

function buildPlannedIndex(items: Movie[]): PlannedIndex {
  const entries: IndexedMovie[] = [];
  const exact = new Map<string, IndexedMovie[]>();
  for (const movie of items) {
    // Base names only (title + playlist title). Episode-level names inside a
    // collection are never wishlist targets ("Episode 12") and used to
    // multiply this loop by the episode count of big series.
    const seen = new Set<string>();
    const names: IndexedName[] = [];
    for (const raw of [movie.title, movie.playlistTitle]) {
      const indexed = indexName(raw, seen);
      if (indexed) names.push(indexed);
    }
    if (names.length === 0) continue;
    const entry: IndexedMovie = { movie, names };
    entries.push(entry);
    for (const { n } of names) {
      const list = exact.get(n);
      if (list) list.push(entry);
      else exact.set(n, [entry]);
    }
  }
  return { entries, exact };
}

const indexCache = new WeakMap<Movie[], PlannedIndex>();

/** Cached index for an items array — rebuilt only when the array identity changes. */
export function getPlannedIndex(items: Movie[]): PlannedIndex {
  let idx = indexCache.get(items);
  if (!idx) {
    idx = buildPlannedIndex(items);
    indexCache.set(items, idx);
  }
  return idx;
}

/** Query-side derivations, computed once per matchPlannedTitle call. */
interface PlannedPrecomp {
  stripped: string;
  sorted: string;
  forms: Array<{ t: string; len: number }>;
  queryHasDigit: boolean;
  len: number;
}

/**
 * Cheap (allocation-free) score for one query/name pair. Returns at most 2 —
 * exact matches (3) are served by the index map, fuzzy scores (≤0.8) by the
 * dedicated pass below.
 */
function cheapScore(planned: string, name: IndexedName, pre: PlannedPrecomp): number {
  const nm = name.n;
  if (!planned || !nm) return 0;
  if (nm.startsWith(planned)) return 2;
  if (planned.length >= 3 && nm.includes(planned)) return 1.5;
  // "Demon Slayer — Season 3" still finds the base entry.
  const ps = pre.stripped;
  const ns = name.hasDigit ? name.s : nm;
  if (ps && ns && (ps !== planned || ns !== nm)) {
    if (ns === ps) return 1.25;
    if (ns.startsWith(ps) || ps.startsWith(ns)) return 1;
    if (ps.length >= 3 && ns.includes(ps)) return 0.9;
  }
  if (planned.length >= 6 && nm.length >= 6) {
    // Word-order differences: "Shippuden Naruto" finds "Naruto Shippuden".
    if (name.sorted === pre.sorted) return 1.4;
  }
  // Planned title merely contains the library name ("One Piece Film Red").
  if (nm.length >= 3 && planned.includes(nm)) return 0.75;
  return 0;
}

/**
 * Sound-ish prefilter for the fuzzy pass: a typo-tolerant hit between two
 * derivations can only exist when their head characters roughly agree, so
 * names whose head disagrees skip every similarity() call. Passes when the
 * first 4 chars differ by ≤1 substitution, or either head is a subsequence
 * of the other's 8-char head (insertion/deletion at the start, e.g.
 * "Nnaruto"). A single typo anywhere — including the first character —
 * always passes; only 2+ clustered early typos on long titles are skipped,
 * which no wishlist query relies on.
 */
function headSubseq(s: string, t: string): boolean {
  let j = 0;
  for (let i = 0; i < 4; i++) {
    const c = s.charCodeAt(i);
    while (j < 8 && t.charCodeAt(j) !== c) j++;
    if (j >= 8) return false;
    j++;
  }
  return true;
}

function headsAgree(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < 4; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      diff++;
      if (diff > 1) break;
    }
  }
  if (diff <= 1) return true;
  return headSubseq(a, b) || headSubseq(b, a);
}

/** Any of the four (query × name) head pairs agrees (covers word-order too). */
function fuzzyGate(planned: string, pSorted: string, name: IndexedName): boolean {
  const nm = name.n;
  const nSorted = name.sorted;
  return (
    headsAgree(planned, nm) ||
    headsAgree(planned, nSorted) ||
    headsAgree(pSorted, nm) ||
    headsAgree(pSorted, nSorted)
  );
}

/** Fuzzy score (0.8 / 0.5 / 0) — only reached when cheap matching fell short. */
function fuzzyScore(planned: string, name: IndexedName, pre: PlannedPrecomp): number {
  const nm = name.n;
  if (pre.len < 6 || name.len < 6) return 0;
  // Small typos on the full title ("Narruto", "One Peice"). Outranks a bare
  // substring below, so "Naruto Shippduen" picks Shippuden over plain Naruto.
  if (lengthCompatible(pre.len, name.len) && similarity(planned, nm) >= 0.85) return 0.8;
  // Last resort: typos inside a leading portion ("Demom Slayer" vs
  // "Demon Slayer: Kimetsu no Yaiba"). Strict on purpose — long titles only,
  // so short lookalikes like Naruto/Boruto never cross-match.
  for (const pf of pre.forms) {
    for (let k = 0; k < name.subsets.length; k++) {
      const nf = name.subsets[k];
      if (!lengthCompatible(pf.len, nf.len)) continue;
      if (similarity(pf.t, nf.t) >= 0.85) return 0.5;
    }
  }
  return 0;
}

function matchWithIndex(
  plannedTitle: string,
  index: PlannedIndex,
  excludeIds?: Set<number>,
): Movie | null {
  const planned = normalizeTitle(plannedTitle);
  if (!planned) return null;
  const excluded = (entry: IndexedMovie) => excludeIds?.has(entry.movie.id) ?? false;

  // Pass 1: exact map hit (score 3 — nothing can beat it).
  const exactList = index.exact.get(planned);
  if (exactList) {
    for (const entry of exactList) {
      if (!excluded(entry)) return entry.movie;
    }
  }

  // Hoisted out of the per-movie loop: these depend only on the query.
  const pSorted = sortedTokens(planned);
  const queryHasDigit = /\d/.test(planned);
  const formSeen = new Set<string>();
  const forms: Array<{ t: string; len: number }> = [];
  for (const t of [pSorted, ...leadingSubsets(planned), ...leadingSubsets(pSorted)]) {
    if (formSeen.has(t)) continue;
    formSeen.add(t);
    forms.push({ t, len: t.length });
  }
  const pre: PlannedPrecomp = {
    stripped: queryHasDigit ? stripQualifier(planned) : planned,
    sorted: pSorted,
    forms,
    queryHasDigit,
    len: planned.length,
  };

  // Pass 2: cheap scan in library order. Score 2 (startsWith) ends the search
  // — with exact matches already ruled out, nothing scores higher.
  let best: IndexedMovie | null = null;
  let bestScore = 0;
  for (const entry of index.entries) {
    if (excluded(entry)) continue;
    for (const name of entry.names) {
      const score = cheapScore(planned, name, pre);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
        if (score >= 2) return entry.movie;
      }
    }
  }
  // Fuzzy scores top out at 0.8 — a cheap 0.9+ can never lose to them.
  if (bestScore >= 0.9) return best ? best.movie : null;

  // Pass 3: typo tolerance over base names only. The head gate rejects ~99%
  // of names with a few integer compares before any similarity() runs.
  if (pre.len >= 6) {
    for (const entry of index.entries) {
      if (excluded(entry)) continue;
      for (const name of entry.names) {
        if (name.len < 6) continue;
        if (!fuzzyGate(planned, pre.sorted, name)) continue;
        const score = fuzzyScore(planned, name, pre);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      }
    }
  }
  return bestScore > 0 && best ? best.movie : null;
}

/** Best library match for one planned title (null = show a placeholder). */
export function matchPlannedTitle(
  plannedTitle: string,
  items: Movie[],
  excludeIds?: Set<number>,
): Movie | null {
  return matchWithIndex(plannedTitle, getPlannedIndex(items), excludeIds);
}

/**
 * Resolve a wishlist into ordered slots. Every title becomes either its
 * matched movie or a "Coming Soon" placeholder — so the row keeps its shape
 * and fills in automatically as titles get added to the library.
 */
export function resolvePlannedSlots(plannedTitles: string[], items: Movie[]): RowSlot[] {
  const index = getPlannedIndex(items);
  const used = new Set<number>();
  const seenTitles = new Set<string>();
  const slots: RowSlot[] = [];
  for (const raw of plannedTitles) {
    const title = (raw || "").trim();
    if (!title) continue;
    const norm = normalizeTitle(title);
    if (!norm || seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    const movie = matchWithIndex(title, index, used);
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
