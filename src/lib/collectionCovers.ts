import { useEffect, useState } from "react";

const KEY = "vid:collectionCovers:v1";
const EVENT = "vid:collectionCovers";

export type CollectionCovers = Record<string, string>;

export function loadCollectionCovers(): CollectionCovers {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CollectionCovers) : {};
  } catch {
    return {};
  }
}

export function setCollectionCover(playlistId: string | undefined, url: string) {
  if (!playlistId || typeof window === "undefined") return;
  const covers = loadCollectionCovers();
  covers[playlistId] = url;
  try {
    localStorage.setItem(KEY, JSON.stringify(covers));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function clearCollectionCover(playlistId: string | undefined) {
  if (!playlistId || typeof window === "undefined") return;
  const covers = loadCollectionCovers();
  if (!(playlistId in covers)) return;
  delete covers[playlistId];
  try {
    localStorage.setItem(KEY, JSON.stringify(covers));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useCollectionCovers(): CollectionCovers {
  const [covers, setCovers] = useState<CollectionCovers>(() => loadCollectionCovers());
  useEffect(() => {
    const sync = () => setCovers(loadCollectionCovers());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return covers;
}
