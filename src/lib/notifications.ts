/**
 * Website notifications — naya anime/series ya naya episode aane par message.
 * ===========================================================================
 * Koi backend table nahi chahiye: har visit par library ka ek chhota snapshot
 * (playlist → episode count + highest SxE, singles → ids) localStorage me
 * rakha jata hai. Agli baar library load hone par diff nikalta hai:
 *
 *   - Naya playlistId          → "🎬 Naya add hua: {title}"
 *   - Purane playlist me nayi
 *     highest S/E entry        → "📺 {title} — naya episode S{s}E{e}"
 *   - Naya standalone video    → "Naya video: {title}" (bulk par grouped)
 *
 * Pehli visit par sirf snapshot ban jata hai (koi spam nahi). Notifications
 * ki list (max 50) bhi localStorage me hi rehti hai, unread/read ke saath.
 * Kyunki anime-sync GitHub Action har 6 ghante naye episodes Supabase me
 * daalti hai, user ko agli visit/refresh par turant message dikh jata hai.
 */

import type { Movie } from "../data";
import { safeLocalStorage } from "./safe-storage";

export interface AppNotification {
  id: string;
  type: "new-series" | "new-episode" | "new-video";
  title: string; // heading (series/video ka naam)
  message: string; // detail line
  image: string;
  playlistId?: string;
  movieId?: number;
  at: number; // epoch ms
  read: boolean;
}

interface PlaylistSnap {
  count: number;
  maxKey: number; // season*10000 + episode — highest dekha hua
  title: string;
}

interface LibrarySnapshot {
  v: 1;
  playlists: Record<string, PlaylistSnap>;
  singles: number[]; // standalone (non-playlist) movie ids
  savedAt: number;
}

const SNAP_KEY = "vidd-notif-snapshot-v1";
const LIST_KEY = "vidd-notifications-v1";
const MAX_NOTIFS = 50;

const epKey = (m: Movie) => (m.seasonNumber || 1) * 10000 + (m.episodeNumber || 0);
const epLabel = (m: Movie) => `S${m.seasonNumber || 1}E${m.episodeNumber || 0}`;

function loadSnapshot(): LibrarySnapshot | null {
  try {
    const raw = safeLocalStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.v === 1 ? (parsed as LibrarySnapshot) : null;
  } catch {
    return null;
  }
}

function saveSnapshot(snap: LibrarySnapshot) {
  try {
    safeLocalStorage.setItem(SNAP_KEY, JSON.stringify(snap));
  } catch {
    /* storage full — notifications optional feature hai */
  }
}

export function loadNotifications(): AppNotification[] {
  try {
    const raw = safeLocalStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppNotification[]) : [];
  } catch {
    return [];
  }
}

function saveNotifications(list: AppNotification[]) {
  try {
    safeLocalStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, MAX_NOTIFS)));
  } catch {
    /* ignore */
  }
}

function buildSnapshot(allMovies: Movie[]): LibrarySnapshot {
  const playlists: Record<string, PlaylistSnap> = {};
  const singles: number[] = [];
  for (const m of allMovies) {
    if (m.isCollection) continue;
    if (m.playlistId) {
      const p = (playlists[m.playlistId] ||= {
        count: 0,
        maxKey: 0,
        title: m.playlistTitle || m.title,
      });
      p.count++;
      const k = epKey(m);
      if (k > p.maxKey) p.maxKey = k;
      if (m.playlistTitle) p.title = m.playlistTitle;
    } else {
      singles.push(m.id);
    }
  }
  return { v: 1, playlists, singles, savedAt: Date.now() };
}

/**
 * Library ke against snapshot diff karo, naye notifications banao, snapshot
 * update karo, aur poori (nayi + purani) list return karo — newest first.
 */
export function syncNotifications(allMovies: Movie[]): AppNotification[] {
  const existing = loadNotifications();
  if (allMovies.length === 0) return existing;

  const current = buildSnapshot(allMovies);
  const prev = loadSnapshot();

  // Pehli visit — baseline set karo, koi notification spam nahi.
  if (!prev) {
    saveSnapshot(current);
    return existing;
  }

  const fresh: AppNotification[] = [];
  const now = Date.now();

  // Movie lookup for images / labels
  const byPlaylist = new Map<string, Movie[]>();
  for (const m of allMovies) {
    if (m.isCollection || !m.playlistId) continue;
    const arr = byPlaylist.get(m.playlistId) || [];
    arr.push(m);
    byPlaylist.set(m.playlistId, arr);
  }

  for (const [pid, snap] of Object.entries(current.playlists)) {
    const eps = byPlaylist.get(pid) || [];
    const cover = eps[0]?.thumbnailUrl || eps[0]?.image || "";
    const old = prev.playlists[pid];
    if (!old) {
      // Bilkul naya series/anime add hua
      fresh.push({
        id: `series-${pid}-${now}`,
        type: "new-series",
        title: snap.title,
        message: `Naya add hua — ${snap.count} episode${snap.count > 1 ? "s" : ""} available 🎬`,
        image: cover,
        playlistId: pid,
        at: now,
        read: false,
      });
      continue;
    }
    // Purana series — naye (higher SxE) episodes?
    const newEps = eps.filter((e) => epKey(e) > old.maxKey).sort((a, b) => epKey(a) - epKey(b));
    if (newEps.length > 0) {
      const latest = newEps[newEps.length - 1];
      fresh.push({
        id: `ep-${pid}-${epKey(latest)}-${now}`,
        type: "new-episode",
        title: snap.title,
        message:
          newEps.length === 1
            ? `Naya episode aaya — ${epLabel(latest)} 📺`
            : `${newEps.length} naye episodes — ${epLabel(newEps[0])} se ${epLabel(latest)} tak 📺`,
        image: latest.thumbnailUrl || latest.image || cover,
        playlistId: pid,
        at: now,
        read: false,
      });
    }
  }

  // Standalone videos (bina playlist ke)
  const oldSingles = new Set(prev.singles);
  const newSingles = allMovies.filter(
    (m) => !m.isCollection && !m.playlistId && !oldSingles.has(m.id),
  );
  if (newSingles.length > 3) {
    fresh.push({
      id: `videos-${now}`,
      type: "new-video",
      title: `${newSingles.length} naye videos`,
      message: `${newSingles[0].title} aur ${newSingles.length - 1} aur add hue 🍿`,
      image: newSingles[0].thumbnailUrl || newSingles[0].image || "",
      at: now,
      read: false,
    });
  } else {
    for (const m of newSingles) {
      fresh.push({
        id: `video-${m.id}-${now}`,
        type: "new-video",
        title: m.title,
        message: "Naya video add hua 🍿",
        image: m.thumbnailUrl || m.image || "",
        movieId: m.id,
        at: now,
        read: false,
      });
    }
  }

  saveSnapshot(current);
  if (fresh.length === 0) return existing;

  const merged = [...fresh, ...existing].slice(0, MAX_NOTIFS);
  saveNotifications(merged);
  return merged;
}

/** Sab read mark karo (panel band karte waqt) aur updated list return karo. */
export function markAllNotificationsRead(): AppNotification[] {
  const list = loadNotifications().map((n) => (n.read ? n : { ...n, read: true }));
  saveNotifications(list);
  return list;
}

export function unreadCount(list: AppNotification[]): number {
  return list.reduce((a, n) => a + (n.read ? 0 : 1), 0);
}

/** "2 min pehle" style relative time. */
export function timeAgo(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "abhi";
  if (min < 60) return `${min} min pehle`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ghante pehle`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d} din pehle`;
  return new Date(at).toLocaleDateString();
}
