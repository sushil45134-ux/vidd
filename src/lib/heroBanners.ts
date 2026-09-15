import { useEffect, useState } from "react";
import { safeLocalStorage } from "./safe-storage";

export interface HeroBanner {
  movieId: number;
  bannerImage: string; // data URL or http URL
  title?: string;
  description?: string;
  badge?: string;
  /**
   * Which page this banner shows on. Missing/undefined = "home" (every
   * banner saved before sections existed keeps working as a home banner).
   */
  section?: HeroSection;
}

/** Pages that can have their own admin-set banner. */
export const HERO_SECTIONS = ["home", "movies", "anime", "cartoon"] as const;
export type HeroSection = (typeof HERO_SECTIONS)[number];

export const HERO_SECTION_LABELS: Record<HeroSection, string> = {
  home: "Home",
  movies: "Movies",
  anime: "Anime",
  cartoon: "Cartoon",
};

export function bannerSection(b: HeroBanner): HeroSection {
  return b.section ?? "home";
}

/**
 * Section encoding inside `sort_order` — no Supabase schema change needed.
 *
 * hero_banners.movie_id is the primary key, so a section column would need a
 * database migration on the live project. Instead each section owns a
 * 1000-wide sort_order band: home 0–999, movies 1000–1999, anime 2000–2999,
 * cartoon 3000–3999. Every pre-section row has a small sort_order (0, 1, 2…),
 * so it decodes to "home" automatically and nothing ever breaks.
 */
const SECTION_STEP = 1000;
const SECTION_OFFSET: Record<HeroSection, number> = {
  home: 0,
  movies: SECTION_STEP,
  anime: SECTION_STEP * 2,
  cartoon: SECTION_STEP * 3,
};

function encodeSortOrder(section: HeroSection, indexInSection: number): number {
  return SECTION_OFFSET[section] + Math.max(0, Math.min(indexInSection, SECTION_STEP - 1));
}

function decodeSection(sortOrder: unknown): HeroSection {
  const order = typeof sortOrder === "number" && Number.isFinite(sortOrder) ? sortOrder : 0;
  const idx = Math.max(0, Math.min(Math.floor(order / SECTION_STEP), HERO_SECTIONS.length - 1));
  return HERO_SECTIONS[idx];
}

const KEY = "vid:hero-banners:v2";
const EVENT = "vid:hero-banners-changed";

// ---------- local cache (offline / instant load) ----------
function readLocal(): HeroBanner[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = safeLocalStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HeroBanner[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: HeroBanner[]) {
  try {
    safeLocalStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    alert(
      "Banner image is too large to save locally. Please pick a smaller image (under ~2 MB) or use an image URL instead.",
    );
    throw e;
  }
  window.dispatchEvent(new Event(EVENT));
}

// ---------- remote (Supabase) ----------
function rowToBanner(r: any): HeroBanner {
  return {
    movieId: Number(r.movie_id),
    bannerImage: r.banner_image,
    title: r.title ?? undefined,
    description: r.description ?? undefined,
    badge: r.badge ?? undefined,
    section: decodeSection(r.sort_order),
  };
}

function bannerToRow(b: HeroBanner, indexInSection: number) {
  return {
    movie_id: b.movieId,
    banner_image: b.bannerImage,
    title: b.title ?? null,
    description: b.description ?? null,
    badge: b.badge ?? null,
    sort_order: encodeSortOrder(bannerSection(b), indexInSection),
  };
}

async function fetchRemote(): Promise<HeroBanner[] | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("hero_banners")
      .select("movie_id,banner_image,title,description,badge,sort_order")
      .order("sort_order", { ascending: true });
    if (error) {
      console.warn("[heroBanners] fetch error", error);
      return null;
    }
    return (data ?? []).map(rowToBanner);
  } catch (e) {
    console.warn("[heroBanners] fetch exception", e);
    return null;
  }
}

async function deleteRemote(movieId: number): Promise<boolean> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.from("hero_banners").delete().eq("movie_id", movieId);
    if (error) {
      console.warn("[heroBanners] delete error", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[heroBanners] delete exception", e);
    return false;
  }
}

async function replaceRemote(list: HeroBanner[]): Promise<boolean> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    // Simple strategy: upsert all with fresh sort_order; delete rows that were removed.
    const { data: existing, error: fetchErr } = await supabase
      .from("hero_banners")
      .select("movie_id");
    if (fetchErr) {
      console.warn("[heroBanners] replace fetch error", fetchErr);
      return false;
    }
    const keepIds = new Set(list.map((b) => b.movieId));
    const toDelete = (existing ?? [])
      .map((r: any) => Number(r.movie_id))
      .filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("hero_banners")
        .delete()
        .in("movie_id", toDelete);
      if (delErr) console.warn("[heroBanners] replace delete error", delErr);
    }
    if (list.length > 0) {
      // Per-section position (0, 1, 2…) — the section band is encoded by
      // bannerToRow, so every page keeps its own banner order.
      const counters = new Map<HeroSection, number>();
      const rows = list.map((b) => {
        const section = bannerSection(b);
        const idx = counters.get(section) ?? 0;
        counters.set(section, idx + 1);
        return bannerToRow({ ...b, section }, idx);
      });
      const { error: upErr } = await supabase
        .from("hero_banners")
        .upsert(rows, { onConflict: "movie_id" });
      if (upErr) {
        console.warn("[heroBanners] replace upsert error", upErr);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn("[heroBanners] replace exception", e);
    return false;
  }
}

// ---------- public API (unchanged surface) ----------
export function loadHeroBanners(): HeroBanner[] {
  return readLocal();
}

export async function saveHeroBanners(list: HeroBanner[]): Promise<boolean> {
  const saved = await replaceRemote(list);
  if (!saved) {
    alert(
      "Hero banners public website par save nahi hue. Supabase hero_banners table ki RLS/GRANT policy check karo, phir dobara save karo.",
    );
    return false;
  }
  writeLocal(list);
  return true;
}

export async function upsertHeroBanner(entry: HeroBanner): Promise<boolean> {
  const section = bannerSection(entry);
  const normalized: HeroBanner = { ...entry, section };
  // The movie goes to the FRONT of its own section (other sections keep
  // their order). A full rewrite keeps the cross-device order exact.
  const rest = readLocal().filter((b) => b.movieId !== entry.movieId);
  const at = rest.findIndex((b) => bannerSection(b) === section);
  const next =
    at === -1 ? [...rest, normalized] : [...rest.slice(0, at), normalized, ...rest.slice(at)];
  const saved = await replaceRemote(next);
  if (!saved) {
    alert(
      "Hero banner public website par save nahi hua. Supabase hero_banners table ki RLS/GRANT policy check karo, phir dobara save karo.",
    );
    return false;
  }
  writeLocal(next);
  return true;
}

export async function removeHeroBanner(movieId: number): Promise<boolean> {
  const next = readLocal().filter((b) => b.movieId !== movieId);
  const deleted = await deleteRemote(movieId);
  if (!deleted) {
    alert(
      "Hero banner public website se remove nahi hua. Supabase hero_banners table ki RLS/GRANT policy check karo, phir dobara try karo.",
    );
    return false;
  }
  writeLocal(next);
  return true;
}

export function useHeroBanners(): HeroBanner[] {
  const [list, setList] = useState<HeroBanner[]>(() => readLocal());
  useEffect(() => {
    let alive = true;
    // Kick off remote fetch to hydrate from DB (source of truth across devices).
    fetchRemote().then((remote) => {
      if (!alive || !remote) return;
      // Write remote into local cache and notify.
      try {
        safeLocalStorage.setItem(KEY, JSON.stringify(remote));
      } catch {
        /* ignore quota */
      }
      setList(remote);
      window.dispatchEvent(new Event(EVENT));
    });
    const handler = () => setList(readLocal());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return list;
}
