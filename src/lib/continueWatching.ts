import { useEffect, useMemo, useState } from "react";
import type { Movie } from "../data";
import { getMovieRef } from "./customization";
import { safeLocalStorage } from "./safe-storage";

/** One in-progress video (movie, episode, or embed). */
export interface ContinueWatchingEntry {
  key: string;
  /** Slim snapshot so the row renders even before the library loads. */
  movie: Movie;
  progressSec: number;
  /** 0 = unknown (cross-origin iframe embeds expose no clock). */
  durationSec: number;
  updatedAt: number;
}

/** Entry reconciled with the live library (fresh artwork/titles). */
export interface ResumeItem {
  key: string;
  movie: Movie;
  progressSec: number;
  durationSec: number;
  updatedAt: number;
  /** 0..1 — 0 when the duration is unknown. */
  percent: number;
}

const STORAGE_KEY = "vid:continue-watching:v1";
const EVENT = "vid:continue-watching-changed";
const MAX_ITEMS = 20;
/** Below this we treat the play as an accidental open and keep the old entry. */
const MIN_PROGRESS_SEC = 5;
/** At/after this the video counts as finished and leaves the row. */
const FINISHED_RATIO = 0.95;
const FINISHED_TAIL_SEC = 10;

export function continueWatchingKey(movie: Movie): string {
  return getMovieRef(movie);
}

function notifyChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* Listeners are optional — never break playback. */
  }
}

export function loadContinueWatching(): ContinueWatchingEntry[] {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ContinueWatchingEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.key === "string" && e.movie && typeof e.movie.id === "number")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function persist(entries: ContinueWatchingEntry[]) {
  const trimmed = entries.slice(0, MAX_ITEMS);
  try {
    safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* Storage full/blocked — the row just won't persist. */
  }
  notifyChanged();
}

/** Record playback progress (the caller throttles). Finished videos are dropped. */
export function saveWatchProgress(movie: Movie, progressSec: number, durationSec: number): void {
  if (typeof window === "undefined") return;
  const key = continueWatchingKey(movie);
  const progress = Math.max(0, Math.floor(progressSec || 0));
  const duration = Math.max(0, Math.floor(durationSec || 0));
  const entries = loadContinueWatching();

  if (duration > 0) {
    const remaining = duration - progress;
    if (progress / duration >= FINISHED_RATIO || remaining <= FINISHED_TAIL_SEC) {
      const next = entries.filter((e) => e.key !== key);
      if (next.length !== entries.length) persist(next);
      return;
    }
    // Accidental open (or a flush right after seek-to-0): keep the old entry.
    if (progress < MIN_PROGRESS_SEC) return;
  }
  // duration 0 (iframe embeds): remember it as started — resume restarts it.
  // Strip nested episode graphs so one entry can never bloat localStorage.
  const { episodes: _episodes, seasons: _seasons, ...slim } = movie;
  void _episodes;
  void _seasons;
  const next = entries.filter((e) => e.key !== key);
  next.unshift({
    key,
    movie: slim as Movie,
    progressSec: progress,
    durationSec: duration,
    updatedAt: Date.now(),
  });
  persist(next);
}

/** Drop a video from the row (playback ended). */
export function markWatchFinished(movie: Movie): void {
  if (typeof window === "undefined") return;
  const key = continueWatchingKey(movie);
  const entries = loadContinueWatching();
  const next = entries.filter((e) => e.key !== key);
  if (next.length !== entries.length) persist(next);
}

export function removeContinueWatching(key: string): void {
  if (typeof window === "undefined") return;
  persist(loadContinueWatching().filter((e) => e.key !== key));
}

/** Drop a library item (and, for series, every episode entry) from the row. */
export function removeContinueWatchingForMovie(movie: Movie): void {
  if (typeof window === "undefined") return;
  const keys = new Set<string>([continueWatchingKey(movie)]);
  const ids = new Set<number>([movie.id]);
  movie.episodes?.forEach((ep) => {
    keys.add(continueWatchingKey(ep));
    ids.add(ep.id);
  });
  persist(loadContinueWatching().filter((e) => !keys.has(e.key) && !ids.has(e.movie?.id)));
}

/** Seconds to resume from (0 = play from the start). */
export function getSavedProgress(movie: Movie): number {
  const key = continueWatchingKey(movie);
  const entry = loadContinueWatching().find((e) => e.key === key);
  if (!entry || entry.durationSec <= 0 || entry.progressSec < MIN_PROGRESS_SEC) return 0;
  return entry.progressSec;
}

function toResumeItem(entry: ContinueWatchingEntry, movie: Movie): ResumeItem {
  const percent =
    entry.durationSec > 0 ? Math.min(1, Math.max(0, entry.progressSec / entry.durationSec)) : 0;
  return {
    key: entry.key,
    movie,
    progressSec: entry.progressSec,
    durationSec: entry.durationSec,
    updatedAt: entry.updatedAt,
    percent,
  };
}

/** Live list for the home row — snapshots reconciled with fresh library data. */
export function useContinueWatching(library: Movie[]): ResumeItem[] {
  const [entries, setEntries] = useState<ContinueWatchingEntry[]>(() => loadContinueWatching());

  useEffect(() => {
    const refresh = () => setEntries(loadContinueWatching());
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return useMemo(() => {
    const byId = new Map<number, Movie>();
    const byRef = new Map<string, Movie>();
    const index = (m: Movie) => {
      if (!byId.has(m.id)) byId.set(m.id, m);
      const ref = getMovieRef(m);
      if (!byRef.has(ref)) byRef.set(ref, m);
    };
    library.forEach((m) => {
      index(m);
      m.episodes?.forEach(index);
    });
    return entries
      .map((e) => toResumeItem(e, byId.get(e.movie?.id) ?? byRef.get(e.key) ?? e.movie))
      .filter((r) => !!r.movie);
  }, [entries, library]);
}

/** Resume state for one title (exact match, or the newest episode for series). */
export function useResumeForMovie(movie: Movie | null): ResumeItem | null {
  const [resume, setResume] = useState<ResumeItem | null>(null);
  const movieId = movie?.id ?? null;
  const movieRef = movie ? continueWatchingKey(movie) : null;
  const playlistId = movie?.isCollection
    ? movie.playlistId || movie.episodes?.[0]?.playlistId || null
    : null;

  useEffect(() => {
    if (!movie || !movieRef) {
      setResume(null);
      return;
    }
    const refresh = () => {
      const entries = loadContinueWatching();
      const direct = entries.find((e) => e.key === movieRef);
      if (direct) {
        setResume(toResumeItem(direct, movie));
        return;
      }
      if (playlistId) {
        const ep = entries.find(
          (e) => (e.movie?.playlistId || e.movie?.episodes?.[0]?.playlistId) === playlistId,
        );
        setResume(ep ? toResumeItem(ep, ep.movie) : null);
        return;
      }
      setResume(null);
    };
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
    // movie identity only changes when a different title is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId, movieRef, playlistId]);

  return resume;
}

/** "12m left" / "1h 5m left" / "45s left" */
export function formatTimeLeft(remainingSec: number): string {
  const s = Math.max(0, Math.floor(remainingSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m left`;
  return `${sec}s left`;
}

/** "12:34" / "1:05:20" — for "Resume from …" labels. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "S1 E5" style tag for episode entries, else "". */
export function episodeTag(movie: Movie): string {
  if (movie.episodeNumber == null && movie.seasonNumber == null) return "";
  const s = movie.seasonNumber ?? 1;
  const e = movie.episodeNumber ?? 0;
  return e > 0 ? `S${s} E${e}` : `S${s}`;
}
