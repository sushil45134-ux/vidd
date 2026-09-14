import type { Movie } from "../data";

/** One ordered slot inside a planned (wishlist) row. */
export type RowSlot = { kind: "movie"; movie: Movie } | { kind: "placeholder"; title: string };

/** Normalize for title matching: case, punctuation, ×/x, extra spaces. */
export function normalizeTitle(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[×✕]/g, "x")
    .replace(/[''ʼ`]/g, "")
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

function matchScore(planned: string, name: string): number {
  if (!planned || !name) return 0;
  if (name === planned) return 3;
  if (name.startsWith(planned)) return 2;
  if (planned.length >= 3 && name.includes(planned)) return 1.5;
  if (name.length >= 3 && planned.includes(name)) return 0.75;
  // "Demon Slayer — Season 3" still finds the base entry.
  const ps = stripQualifier(planned);
  const ns = stripQualifier(name);
  if (ps && ns && (ps !== planned || ns !== name)) {
    if (ns === ps) return 1.25;
    if (ns.startsWith(ps) || ps.startsWith(ns)) return 1;
    if (ps.length >= 3 && ns.includes(ps)) return 0.9;
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
