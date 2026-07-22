import { useState, useEffect, useRef } from "react";
import { X, RefreshCw, Check, Play, Loader, Sparkles, Plus, Trash2 } from "lucide-react";
import type { Movie } from "../data";
import { analyzeVideo } from "../utils/aiAnalyze";

interface PlaylistSyncProps {
  onClose: () => void;
  onSync: (movies: Movie[]) => void;
  existingIds: Set<string>; // youtubeIds already in library
}

interface PlaylistVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  author: string;
  seasonNumber: number;
  sourcePlaylistId: string;
}

interface SeasonInput {
  url: string;
  season: number;
}

interface FetchedSeason {
  playlistId: string;
  title: string;
  season: number;
  videos: PlaylistVideo[];
}

/* ── Extract playlist ID from any YouTube playlist URL ──────── */
function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  if (/^(PL|UU|LL|FL|OL|RD)[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

/* ── Invidious instances to try (public, no key needed) ──────── */
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.privacyredirect.com",
  "https://iv.nbocloud.com",
  "https://invidious.protokolla.fi",
];

async function fetchPlaylist(playlistId: string): Promise<{ title: string; videos: { videoId: string; title: string; thumbnail: string; author: string }[] }> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/playlists/${playlistId}?fields=title,videos`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const videos = (data.videos || []).map((v: any) => ({
        videoId: v.videoId,
        title: v.title,
        thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
        author: v.author || "",
      }));
      return { title: data.title || "", videos };
    } catch {
      continue;
    }
  }
  throw new Error("Could not fetch playlist. Try again later.");
}

export default function PlaylistSync({ onClose, onSync, existingIds }: PlaylistSyncProps) {
  const [seasonInputs, setSeasonInputs] = useState<SeasonInput[]>([{ url: "", season: 1 }]);
  const [fetchedSeasons, setFetchedSeasons] = useState<FetchedSeason[]>([]);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [videos, setVideos] = useState<PlaylistVideo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // key = `${season}:${videoId}`
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"input" | "select" | "done">("input");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [contentType, setContentType] = useState<"Movie" | "Anime" | "Cartoon">("Movie");
  const [useAi, setUseAi] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const keyOf = (v: PlaylistVideo) => `${v.seasonNumber}:${v.videoId}`;

  const addSeasonInput = () => {
    setSeasonInputs((prev) => [...prev, { url: "", season: (prev[prev.length - 1]?.season || prev.length) + 1 }]);
  };
  const removeSeasonInput = (i: number) => {
    setSeasonInputs((prev) => prev.filter((_, idx) => idx !== i));
  };
  const updateSeasonInput = (i: number, patch: Partial<SeasonInput>) => {
    setSeasonInputs((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const doFetchAll = async () => {
    setError("");
    const parsed: { id: string; season: number }[] = [];
    for (const s of seasonInputs) {
      if (!s.url.trim()) continue;
      const id = extractPlaylistId(s.url);
      if (!id) { setError(`Invalid playlist URL for Season ${s.season}`); return; }
      parsed.push({ id, season: s.season });
    }
    if (parsed.length === 0) { setError("Add at least one playlist URL"); return; }
    // Ensure unique seasons — if duplicates, error
    const seasonsSet = new Set(parsed.map((p) => p.season));
    if (seasonsSet.size !== parsed.length) { setError("Season numbers must be unique"); return; }

    setLoading(true);
    try {
      const results = await Promise.all(parsed.map(async (p) => {
        const data = await fetchPlaylist(p.id);
        return { playlistId: p.id, title: data.title, season: p.season, videos: data.videos.map((v) => ({ ...v, seasonNumber: p.season, sourcePlaylistId: p.id })) } as FetchedSeason;
      }));
      results.sort((a, b) => a.season - b.season);
      setFetchedSeasons(results);
      setCollectionTitle(results[0]?.title || "");
      const allVideos = results.flatMap((r) => r.videos);
      setVideos(allVideos);
      const newSel = new Set<string>();
      allVideos.forEach((v) => { if (!existingIds.has(v.videoId)) newSel.add(keyOf(v)); });
      setSelected(newSel);
      setStep("select");
    } catch (err: any) {
      setError(err?.message || "Failed to fetch playlist");
    }
    setLoading(false);
  };

  const toggleVideo = (v: PlaylistVideo) => {
    const k = keyOf(v);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const selectAll = () => {
    const newSel = new Set<string>();
    videos.forEach((v) => { if (!existingIds.has(v.videoId)) newSel.add(keyOf(v)); });
    setSelected(newSel);
  };
  const selectNone = () => setSelected(new Set());

  const doSync = () => {
    // Use first fetched playlist id as shared collection id
    const sharedPlId = fetchedSeasons[0]?.playlistId || `pl_${Date.now()}`;
    const sharedTitle = collectionTitle || fetchedSeasons[0]?.title || "";

    // Group selected videos by season, index per season
    const bySeason = new Map<number, PlaylistVideo[]>();
    for (const v of videos) {
      if (!selected.has(keyOf(v))) continue;
      if (!bySeason.has(v.seasonNumber)) bySeason.set(v.seasonNumber, []);
      bySeason.get(v.seasonNumber)!.push(v);
    }

    const movies: Movie[] = [];
    let idCounter = Date.now();
    Array.from(bySeason.keys()).sort((a, b) => a - b).forEach((season) => {
      const list = bySeason.get(season)!;
      list.forEach((v, i) => {
        const base = {
          playlistId: sharedPlId,
          playlistTitle: sharedTitle,
          episodeNumber: i + 1,
          seasonNumber: season,
        };
        const image = v.thumbnail.startsWith("http") ? v.thumbnail : `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`;
        const backdrop = `https://img.youtube.com/vi/${v.videoId}/maxresdefault.jpg`;
        if (useAi) {
          const ai = analyzeVideo(v.title, v.author);
          movies.push({
            id: idCounter++,
            title: ai.detectedTitle,
            description: ai.description,
            image, backdrop,
            year: ai.year,
            rating: ai.rating,
            duration: "Unknown",
            genre: ai.genres,
            match: ai.confidence,
            cast: [v.author],
            creator: v.author,
            youtubeId: v.videoId,
            thumbnailUrl: `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
            embedPlatform: "YouTube",
            ...base,
          });
        } else {
          movies.push({
            id: idCounter++,
            title: v.title,
            description: `${sharedTitle} — ${v.title}`,
            image, backdrop,
            year: new Date().getFullYear(),
            rating: "PG-13",
            duration: "Unknown",
            genre: [contentType, "YouTube"],
            match: 95,
            cast: [v.author],
            creator: v.author,
            youtubeId: v.videoId,
            thumbnailUrl: `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
            embedPlatform: "YouTube",
            ...base,
          });
        }
      });
    });

    onSync(movies);

    if (autoRefresh && fetchedSeasons.length > 0) {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      refreshTimer.current = setInterval(() => { doFetchAll(); }, refreshInterval * 60 * 1000);
    }

    setStep("done");
  };

  const newCount = videos.filter((v) => !existingIds.has(v.videoId)).length;
  const existingCount = videos.length - newCount;

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/80 backdrop-blur-sm overflow-y-auto pt-6 pb-6" onClick={onClose}>
      <div className="relative w-full max-w-2xl mx-4 bg-[#181818] rounded-lg overflow-hidden shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <RefreshCw size={22} className="text-[#e50914]" />
            <h2 className="text-white text-lg font-bold">YouTube Playlist Sync</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center hover:bg-[#3a3a3a]">
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* ── INPUT STEP ── */}
        {step === "input" && (
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-4">Har season ke liye ek playlist URL daalo. Pehla URL = Season 1, doosra = Season 2, waghera. Sabhi ek hi collection mein group ho jayenge.</p>

            <div className="space-y-2 mb-3">
              {seasonInputs.map((s, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="flex items-center gap-1 bg-[#222] rounded px-2 py-2 border border-gray-700">
                    <span className="text-gray-400 text-xs">S</span>
                    <input
                      type="number"
                      min={1}
                      value={s.season}
                      onChange={(e) => updateSeasonInput(i, { season: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                      className="w-12 bg-transparent text-white text-sm outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    value={s.url}
                    onChange={(e) => { updateSeasonInput(i, { url: e.target.value }); setError(""); }}
                    placeholder={`Season ${s.season} playlist URL`}
                    className="flex-1 bg-[#333] border border-gray-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-[#e50914] transition-colors placeholder-gray-500"
                  />
                  {seasonInputs.length > 1 && (
                    <button onClick={() => removeSeasonInput(i)} className="w-9 h-9 rounded bg-[#2a2a2a] hover:bg-[#3a3a3a] flex items-center justify-center text-gray-400 hover:text-red-400">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mb-4">
              <button onClick={addSeasonInput} className="flex items-center gap-1.5 text-[#e50914] text-sm hover:text-red-400">
                <Plus size={14} /> Add another season
              </button>
              <button onClick={doFetchAll} disabled={loading || !seasonInputs.some((s) => s.url.trim())}
                className="px-5 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors disabled:opacity-40 flex items-center gap-2">
                {loading ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {loading ? "Loading..." : "Fetch all"}
              </button>
            </div>

            {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

            <div className="bg-[#111] rounded-lg p-4">
              <p className="text-gray-400 text-xs font-medium mb-2">Tips:</p>
              <div className="space-y-1.5 text-xs">
                <p className="text-gray-500">• Ek season = ek playlist URL</p>
                <p className="text-gray-500">• Season numbers unique hone chahiye (S1, S2, S3…)</p>
                <p className="text-gray-500">• Saare seasons ek hi collection card ke andar dikhenge</p>
              </div>
            </div>
          </div>
        )}

        {/* ── SELECT STEP ── */}
        {step === "select" && (
          <div className="p-6">
            {/* Collection info */}
            <div className="flex items-center gap-3 mb-4 bg-[#222] rounded-lg px-4 py-3">
              <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
                <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#fff" />
              </svg>
              <div className="flex-1 min-w-0">
                <input
                  value={collectionTitle}
                  onChange={(e) => setCollectionTitle(e.target.value)}
                  className="w-full bg-transparent text-white text-sm font-bold outline-none border-b border-transparent focus:border-gray-600"
                />
                <p className="text-gray-400 text-xs">{fetchedSeasons.length} season(s) • {videos.length} videos • {newCount} new • {existingCount} already in library</p>
              </div>
              <button onClick={doFetchAll} disabled={loading} className="text-gray-400 hover:text-white transition-colors">
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            {/* Select controls */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <button onClick={selectAll} className="text-[#e50914] text-xs hover:text-red-400">Select all new</button>
                <button onClick={selectNone} className="text-gray-500 text-xs hover:text-gray-300">Deselect all</button>
              </div>
              <p className="text-gray-400 text-xs">{selected.size} selected</p>
            </div>

            {/* Video list grouped by season */}
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1 mb-4">
              {fetchedSeasons.map((fs) => (
                <div key={`${fs.playlistId}-${fs.season}`}>
                  <p className="text-gray-300 text-xs font-bold uppercase tracking-wide mb-1.5 px-1">Season {fs.season} · {fs.title}</p>
                  <div className="space-y-1">
                    {fs.videos.map((v) => {
                      const isExisting = existingIds.has(v.videoId);
                      const isSelected = selected.has(keyOf(v));
                      return (
                        <button key={keyOf(v)}
                          onClick={() => !isExisting && toggleVideo(v)}
                          disabled={isExisting}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                            isExisting ? "opacity-40 cursor-not-allowed" : isSelected ? "bg-[#e50914]/10 border border-[#e50914]/30" : "bg-[#222] hover:bg-[#2a2a2a] border border-transparent"
                          }`}
                        >
                          <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border ${
                            isExisting ? "border-gray-600 bg-gray-700" : isSelected ? "border-[#e50914] bg-[#e50914]" : "border-gray-500"
                          }`}>
                            {(isSelected || isExisting) && <Check size={12} className="text-white" />}
                          </div>
                          <img src={`https://img.youtube.com/vi/${v.videoId}/default.jpg`} alt="" className="w-16 h-9 object-cover rounded flex-shrink-0 bg-gray-800" />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${isExisting ? "text-gray-500" : "text-white"}`}>{v.title}</p>
                            <p className="text-gray-500 text-[10px]">{isExisting ? "Already in library" : v.author}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* AI Auto-fill toggle */}
            <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-500/20 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">AI Auto-fill</p>
                    <p className="text-gray-400 text-[10px]">Auto-detect title, category, genres, rating & description</p>
                  </div>
                </div>
                <button onClick={() => setUseAi(!useAi)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${useAi ? "bg-purple-500" : "bg-gray-600"}`}>
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${useAi ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            </div>

            {/* Category (only when AI is off) */}
            {!useAi && (
              <div className="mb-4">
                <p className="text-gray-300 text-sm font-medium mb-2">Category</p>
                <div className="flex gap-2">
                  {(["Movie", "Anime", "Cartoon"] as const).map((t) => (
                    <button key={t} onClick={() => setContentType(t)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${contentType === t ? "bg-[#e50914] text-white" : "bg-[#222] text-gray-400 hover:bg-[#333] hover:text-white"}`}>
                      {t === "Movie" ? "🎬" : t === "Anime" ? "⛩️" : "🎨"} {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-refresh toggle */}
            <div className="bg-[#111] rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">Auto-sync new videos</p>
                  <p className="text-gray-500 text-xs">Check for new uploads periodically</p>
                </div>
                <button onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${autoRefresh ? "bg-[#e50914]" : "bg-gray-600"}`}>
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all ${autoRefresh ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              {autoRefresh && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-gray-400 text-xs">Check every</span>
                  <select value={refreshInterval} onChange={(e) => setRefreshInterval(Number(e.target.value))}
                    className="bg-[#333] border border-gray-600 rounded px-2 py-1 text-white text-xs outline-none">
                    <option value={5}>5 min</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-between">
              <button onClick={() => setStep("input")} className="text-gray-300 text-sm hover:text-white">← Back</button>
              <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-gray-300 text-sm hover:text-white">Cancel</button>
                <button onClick={doSync} disabled={selected.size === 0}
                  className="px-5 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] disabled:opacity-40 flex items-center gap-2">
                  <Play size={14} fill="white" /> Add {selected.size} Video{selected.size !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── DONE STEP ── */}
        {step === "done" && (
          <div className="p-10 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center mb-4 animate-bounce">
              <Check size={32} className="text-white" />
            </div>
            <h3 className="text-white text-xl font-bold mb-2">Synced!</h3>
            <p className="text-gray-400 text-sm mb-1">
              <span className="text-white font-semibold">{selected.size} videos</span> across <span className="text-white font-semibold">{fetchedSeasons.length} season(s)</span> added to <span className="text-white font-semibold">{collectionTitle}</span>.
            </p>
            {autoRefresh && (
              <p className="text-green-400 text-xs mt-2">🔄 Auto-sync enabled — checking every {refreshInterval} min</p>
            )}
            <button onClick={onClose} className="mt-6 px-6 py-2 rounded bg-white text-black text-sm font-bold hover:bg-gray-200">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
