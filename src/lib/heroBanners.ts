import { safeLocalStorage } from "./safe-storage";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface HeroBanner {
  movieId: number;
  bannerImage: string; // data URL or http URL
  title?: string;
  description?: string;
  badge?: string;
}

const KEY = "vid:hero-banners";
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
      "Banner image is too large to save locally. Please pick a smaller image (under ~2 MB) or use an image URL instead."
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
  };
}

function bannerToRow(b: HeroBanner, sort: number) {
  return {
    movie_id: b.movieId,
    banner_image: b.bannerImage,
    title: b.title ?? null,
    description: b.description ?? null,
    badge: b.badge ?? null,
    sort_order: sort,
  };
}

async function fetchRemote(): Promise<HeroBanner[] | null> {
  try {
    const { data, error } = await supabase
      .from("hero_banners")
      .select("*")
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

async function upsertRemote(entry: HeroBanner, sort: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("hero_banners")
      .upsert(bannerToRow(entry, sort), { onConflict: "movie_id" });
    if (error) {
      console.warn("[heroBanners] upsert error", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[heroBanners] upsert exception", e);
    return false;
  }
}

async function deleteRemote(movieId: number): Promise<boolean> {
  try {
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
      const rows = list.map((b, i) => bannerToRow(b, i));
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

export function saveHeroBanners(list: HeroBanner[]) {
  writeLocal(list);
  void replaceRemote(list);
}

export function upsertHeroBanner(entry: HeroBanner) {
  const list = readLocal().filter((b) => b.movieId !== entry.movieId);
  const next = [entry, ...list];
  writeLocal(next);
  void upsertRemote(entry, 0);
}

export function removeHeroBanner(movieId: number) {
  const next = readLocal().filter((b) => b.movieId !== movieId);
  writeLocal(next);
  void deleteRemote(movieId);
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
