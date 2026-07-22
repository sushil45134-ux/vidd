import { useEffect, useState } from "react";

export interface HeroBanner {
  movieId: number;
  bannerImage: string; // data URL or http URL
  title?: string;
  description?: string;
  badge?: string;
}

const KEY = "vid:hero-banners";
const EVENT = "vid:hero-banners-changed";

export function loadHeroBanners(): HeroBanner[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HeroBanner[]) : [];
  } catch {
    return [];
  }
}

export function saveHeroBanners(list: HeroBanner[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    // Likely quota exceeded — banner images can be large.
    alert(
      "Banner image is too large to save. Please pick a smaller image (under ~2 MB) or use an image URL instead."
    );
    throw e;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function upsertHeroBanner(entry: HeroBanner) {
  const list = loadHeroBanners().filter((b) => b.movieId !== entry.movieId);
  saveHeroBanners([entry, ...list]);
}

export function removeHeroBanner(movieId: number) {
  saveHeroBanners(loadHeroBanners().filter((b) => b.movieId !== movieId));
}

export function useHeroBanners(): HeroBanner[] {
  const [list, setList] = useState<HeroBanner[]>([]);
  useEffect(() => {
    setList(loadHeroBanners());
    const handler = () => setList(loadHeroBanners());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return list;
}
