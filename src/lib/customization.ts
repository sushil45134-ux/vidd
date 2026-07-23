import { safeLocalStorage } from "./safe-storage";
import { useEffect, useState } from "react";
import type { Movie } from "../data";
import { supabase } from "@/integrations/supabase/client";

export type RowKey =
  | "uploads"
  | "synced"
  | "trending"
  | "top10"
  | "popular"
  | "action"
  | "new"
  | "mylist"
  | "scifi"
  | "watchagain";

export interface RowConfig {
  key: RowKey;
  title: string;
  visible: boolean;
}

export type TitleSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

export type RowSection = "home" | "movies" | "anime" | "cartoon" | "tvshows" | "new" | "mylist" | "all";

export interface CustomRow {
  id: string;
  title: string;
  titleSize: TitleSize;
  visible: boolean;
  movieIds: number[];
  movieRefs?: string[];
  isLarge?: boolean;
  section?: RowSection; // where this row appears; defaults to "home"
}

export interface SiteConfig {
  brandPrefix: string;
  brandSuffix: string;
  heroBadge: string;
  heroTitle: string;
  heroDescription: string;
  heroOverlayVisible: boolean;
  rows: RowConfig[];
  customRows: CustomRow[];
}

export const DEFAULT_CONFIG: SiteConfig = {
  brandPrefix: "vid",
  brandSuffix: "",
  heroBadge: "⭐ FEATURED",
  heroTitle: "",
  heroDescription: "",
  heroOverlayVisible: true,
  rows: [
    { key: "uploads", title: "🎬 Your Uploads", visible: true },
    { key: "synced", title: "", visible: true },
    { key: "trending", title: "Trending Now", visible: true },
    { key: "top10", title: "Top 10 in U.S. Today", visible: true },
    { key: "popular", title: "Popular on Netflix", visible: true },
    { key: "action", title: "Action & Adventure", visible: true },
    { key: "new", title: "New Releases", visible: true },
    { key: "scifi", title: "Sci-Fi & Fantasy", visible: true },
    { key: "mylist", title: "My List", visible: true },
    { key: "watchagain", title: "Watch Again", visible: true },
  ],
  customRows: [],
};


const KEY = "vid:site-config";
const EVENT = "vid:config-changed";
const PENDING_REMOTE_SAVE_KEY = "vid:site-config-pending-save";
const CUSTOM_ROWS_BACKUP_KEY = "vid:custom-rows-backup";

interface SaveConfigOptions {
  allowEmptyCustomRows?: boolean;
}

function hasCustomRows(cfg: SiteConfig | Partial<SiteConfig> | null | undefined): boolean {
  return (cfg?.customRows?.length || 0) > 0;
}

function isRemoteNewer(remote: any, localSavedAt: string | null): boolean {
  if (!localSavedAt || !remote?.updated_at) return true;
  return new Date(remote.updated_at).getTime() > new Date(localSavedAt).getTime();
}

function mergeConfig(parsed: Partial<SiteConfig>): SiteConfig {
  const rowMap = new Map((parsed.rows || []).map((r) => [r.key, r]));
  const rows = DEFAULT_CONFIG.rows.map((d) => ({ ...d, ...(rowMap.get(d.key) || {}) }));
  return { ...DEFAULT_CONFIG, ...parsed, rows };
}

function loadCustomRowsBackup(): CustomRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = safeLocalStorage.getItem(CUSTOM_ROWS_BACKUP_KEY);
    const rows = raw ? (JSON.parse(raw) as CustomRow[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function rememberCustomRows(rows: CustomRow[]) {
  if (typeof window === "undefined" || rows.length === 0) return;
  safeLocalStorage.setItem(CUSTOM_ROWS_BACKUP_KEY, JSON.stringify(rows));
}

function preserveCustomRows(cfg: SiteConfig, options?: SaveConfigOptions): SiteConfig {
  if (options?.allowEmptyCustomRows || cfg.customRows.length > 0) return cfg;
  const currentRows = loadConfig().customRows;
  if (currentRows.length > 0) return { ...cfg, customRows: currentRows };
  const backupRows = loadCustomRowsBackup();
  if (backupRows.length > 0) return { ...cfg, customRows: backupRows };
  return cfg;
}

function dbRowToConfig(row: any): SiteConfig {
  return mergeConfig({
    brandPrefix: row.brand_prefix,
    brandSuffix: row.brand_suffix,
    heroBadge: row.hero_badge,
    heroTitle: row.hero_title,
    heroDescription: row.hero_description,
    heroOverlayVisible: row.hero_overlay_visible,
    rows: row.rows,
    customRows: row.custom_rows,
  });
}

async function loadRemoteConfig(): Promise<SiteConfig | null> {
  try {
    const { data, error } = await supabase
      .from("site_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return null;
    return dbRowToConfig(data);
  } catch {
    return null;
  }
}

async function saveRemoteConfig(cfg: SiteConfig): Promise<boolean> {
  try {
    const { error } = await supabase.from("site_config").upsert({
      id: 1,
      brand_prefix: cfg.brandPrefix,
      brand_suffix: cfg.brandSuffix,
      hero_badge: cfg.heroBadge,
      hero_title: cfg.heroTitle,
      hero_description: cfg.heroDescription,
      hero_overlay_visible: cfg.heroOverlayVisible,
      rows: cfg.rows,
      custom_rows: cfg.customRows,
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    // Local saving still works if the shared settings table is unavailable.
    return false;
  }
}

export function getMovieRef(movie: Movie): string {
  const collectionPlaylistId = movie.isCollection
    ? movie.episodes?.[0]?.playlistId || movie.playlistId
    : movie.playlistId;
  if (collectionPlaylistId) return `playlist:${collectionPlaylistId}`;
  if (movie.youtubeId) return `youtube:${movie.youtubeId}`;
  if (movie.embedUrl) return `embed:${movie.embedUrl}`;
  if (movie.videoUrl) return `video:${movie.videoUrl}`;
  return `title:${movie.title.trim().toLowerCase()}:${movie.year}`;
}

export function loadConfig(): SiteConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const backupRows = loadCustomRowsBackup();
    const raw = safeLocalStorage.getItem(KEY);
    if (!raw) return backupRows.length > 0 ? { ...DEFAULT_CONFIG, customRows: backupRows } : DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    const merged = mergeConfig(parsed);
    if ((merged.customRows?.length || 0) === 0 && backupRows.length > 0) {
      return { ...merged, customRows: backupRows };
    }
    if ((merged.customRows?.length || 0) > 0) rememberCustomRows(merged.customRows);
    return merged;
  } catch {
    const backupRows = loadCustomRowsBackup();
    return backupRows.length > 0 ? { ...DEFAULT_CONFIG, customRows: backupRows } : DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: SiteConfig, options?: SaveConfigOptions) {
  const next = preserveCustomRows(cfg, options);
  rememberCustomRows(next.customRows);
  safeLocalStorage.setItem(KEY, JSON.stringify(next));
  safeLocalStorage.setItem(PENDING_REMOTE_SAVE_KEY, new Date().toISOString());
  void saveRemoteConfig(next).then((ok) => {
    if (ok) safeLocalStorage.removeItem(PENDING_REMOTE_SAVE_KEY);
  });
  window.dispatchEvent(new Event(EVENT));
}

export function resetConfig() {
  safeLocalStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

export function useSiteConfig(): SiteConfig {
  const [cfg, setCfg] = useState<SiteConfig>(DEFAULT_CONFIG);
  useEffect(() => {
    let alive = true;
    const local = loadConfig();
    const pendingRemoteSaveAt = safeLocalStorage.getItem(PENDING_REMOTE_SAVE_KEY);
    setCfg(local);
    loadRemoteConfig().then((remote) => {
      if (!alive || !remote) return;
      const localHasRows = hasCustomRows(local);
      const remoteHasRows = hasCustomRows(remote);
      if (localHasRows && (!remoteHasRows || !isRemoteNewer(remote, pendingRemoteSaveAt))) {
        void saveRemoteConfig(local).then((ok) => {
          if (ok) safeLocalStorage.removeItem(PENDING_REMOTE_SAVE_KEY);
        });
        return;
      }
      if (remoteHasRows || !localHasRows) {
        safeLocalStorage.setItem(KEY, JSON.stringify(remote));
        setCfg(remote);
      }
    });
    const handler = () => setCfg(loadConfig());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return cfg;
}
