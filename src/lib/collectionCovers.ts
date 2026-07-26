import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

function writeLocal(covers: CollectionCovers) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(covers));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

async function fetchRemote(): Promise<CollectionCovers | null> {
  try {
    const { data, error } = await supabase
      .from("collection_covers")
      .select("playlist_id,image_url");
    if (error) {
      console.warn("[collectionCovers] fetch error", error);
      return null;
    }
    const out: CollectionCovers = {};
    for (const r of (data ?? []) as any[]) {
      if (r?.playlist_id && r?.image_url) out[String(r.playlist_id)] = String(r.image_url);
    }
    return out;
  } catch (e) {
    console.warn("[collectionCovers] fetch exception", e);
    return null;
  }
}

async function saveRemoteOne(playlistId: string, url: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("collection_covers").upsert(
      { playlist_id: playlistId, image_url: url, updated_at: new Date().toISOString() },
      { onConflict: "playlist_id" }
    );
    if (error) {
      console.warn("[collectionCovers] save error", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[collectionCovers] save exception", e);
    return false;
  }
}

async function deleteRemoteOne(playlistId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("collection_covers")
      .delete()
      .eq("playlist_id", playlistId);
    if (error) {
      console.warn("[collectionCovers] delete error", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[collectionCovers] delete exception", e);
    return false;
  }
}


export async function setCollectionCover(
  playlistId: string | undefined,
  url: string
): Promise<boolean> {
  if (!playlistId || typeof window === "undefined") return false;
  const saved = await saveRemoteOne(playlistId, url);
  if (!saved) return false;
  const covers = { ...loadCollectionCovers(), [playlistId]: url };
  writeLocal(covers);
  return true;
}

export async function clearCollectionCover(playlistId: string | undefined): Promise<boolean> {
  if (!playlistId || typeof window === "undefined") return false;
  const deleted = await deleteRemoteOne(playlistId);
  if (!deleted) return false;
  const covers = loadCollectionCovers();
  if (!(playlistId in covers)) return true;
  delete covers[playlistId];
  writeLocal(covers);
  return true;
}

export function useCollectionCovers(): CollectionCovers {
  const [covers, setCovers] = useState<CollectionCovers>({});
  useEffect(() => {
    let alive = true;
    setCovers(loadCollectionCovers());
    void fetchRemote().then((remote) => {
      if (!alive || !remote) return;
      // Supabase is the source of truth for cross-device covers. Do not push
      // stale local-only values back up, because that can make one browser
      // appear changed while phones/other browsers stay unchanged.
      writeLocal(remote);
      setCovers(remote);
    });
    const sync = () => setCovers(loadCollectionCovers());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return covers;
}
