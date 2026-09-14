import { useState, useMemo, useEffect } from "react";
import { Crown, Wand2, Plus, Check, Loader2, Sparkles, Film, Search, Trash2, AlertCircle } from "lucide-react";
import type { Movie } from "../data";
import { loadConfig, saveConfig, getMovieRef, type CustomRow, type RowSection } from "../lib/customization";
import { insertMovies, fetchAllMovies } from "../lib/moviesRepo";
import { autoFetchToMovies, type AutoFetchResult } from "../lib/animeAutoFetch";
import { getProvider, IMDB_PROVIDERS } from "../lib/imdbSeries";

interface Props {
  availableMovies?: Movie[];
  onClose?: () => void;
  onDone?: () => void;
}

interface ParsedItem {
  raw: string;
  name: string;
  imdbId?: string;
  providerId: string;
}

const SECTION_OPTIONS: { value: RowSection; label: string }[] = [
  { value: "movies", label: "Movies" },
  { value: "anime", label: "Anime" },
  { value: "home", label: "Home" },
  { value: "cartoon", label: "Cartoon" },
  { value: "tvshows", label: "TV Shows" },
  { value: "new", label: "New & Popular" },
  { value: "all", label: "All Sections" },
];

function parseList(input: string): ParsedItem[] {
  return input
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      // Format: Name | tt123 | provider  or  Name | tt123  or just Name
      const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
      const name = parts[0] || raw;
      let imdbId: string | undefined;
      let providerId = IMDB_PROVIDERS[0].id; // nxsha now first
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (/^tt\d{6,10}$/.test(p) || /^\d{5,8}$/.test(p)) imdbId = p;
        else if (IMDB_PROVIDERS.some((pr) => pr.id === p.toLowerCase())) providerId = p.toLowerCase();
        else if (p.toLowerCase().includes("nxsha")) providerId = "nxsha";
        else if (p.toLowerCase().includes("nhd")) providerId = "nhd";
      }
      return { raw, name, imdbId, providerId };
    });
}

function findMovieByName(name: string, library: Movie[]): Movie | null {
  const lower = name.toLowerCase();
  // Exact match first
  let found = library.find((m) => m.title.toLowerCase() === lower || (m.playlistTitle && m.playlistTitle.toLowerCase() === lower));
  if (found) return found;
  // Contains
  found = library.find((m) => m.title.toLowerCase().includes(lower) || lower.includes(m.title.toLowerCase()));
  if (found) return found;
  // Fuzzy: check all title variants
  return null;
}

export default function RajaAgent({ availableMovies: propMovies, onDone }: Props) {
  const [internalMovies, setInternalMovies] = useState<Movie[]>([]);
  useEffect(() => {
    if (propMovies && propMovies.length > 0) return;
    fetchAllMovies()
      .then(({ uploaded, synced }) => setInternalMovies([...uploaded, ...synced]))
      .catch(() => {});
  }, [propMovies]);
  const availableMovies = propMovies && propMovies.length > 0 ? propMovies : internalMovies;
  const [listInput, setListInput] = useState("Your Name\nSuzume\nA Silent Voice\nWeathering With You\nViolet Evergarden\nI Want to Eat Your Pancreas");
  const [rowTitle, setRowTitle] = useState("POPULAR MOVIES");
  const [section, setSection] = useState<RowSection>("movies");
  const [defaultImdb, setDefaultImdb] = useState("");
  const [defaultProvider, setDefaultProvider] = useState(IMDB_PROVIDERS[0].id);
  const [isLarge, setIsLarge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [createdRow, setCreatedRow] = useState<CustomRow | null>(null);

  const parsed = useMemo(() => parseList(listInput), [listInput]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  const handleCreate = async () => {
    if (!rowTitle.trim()) {
      addLog("❌ Row title dalo, jaise POPULAR MOVIES");
      return;
    }
    if (parsed.length === 0) {
      addLog("❌ List khali hai — anime/movie naam dalo");
      return;
    }

    setLoading(true);
    setLogs([]);
    setDone(false);

    try {
      addLog(`👑 Raja shuru — ${parsed.length} items, row: ${rowTitle} → section: ${section}`);

      const movieRefs: string[] = [];
      const movieIds: number[] = [];
      const newMoviesToInsert: Movie[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const name = item.name.trim();
        if (!name) continue;

        addLog(`🔍 Checking: ${name}`);

        const existing = findMovieByName(name, availableMovies);
        if (existing) {
          const ref = getMovieRef(existing);
          movieRefs.push(ref);
          movieIds.push(existing.id);
          addLog(`✅ Found in library: ${existing.title} → ${ref}`);
          continue;
        }

        // Not in library — auto-fetch via anime-auto API
        addLog(`🌐 Not in library, fetching from AniList+Jikan: ${name}`);
        try {
          const params = new URLSearchParams({ title: name });
          if (item.imdbId) params.set("imdbId", item.imdbId);
          else if (defaultImdb.trim()) params.set("imdbId", defaultImdb.trim());

          const res = await fetch(`/api/anime-auto?${params.toString()}`);
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `API ${res.status}`);
          }
          const data = (await res.json()) as AutoFetchResult;

          // If IMDb ID provided (per-item or default), generate full series with player links via autoFetchToMovies
          const imdbToUse = item.imdbId || defaultImdb.trim() || undefined;
          if (imdbToUse) {
            const providerId = item.providerId || defaultProvider;
            const movies = autoFetchToMovies(data, {
              imdbId: imdbToUse,
              providerId,
            });
            if (movies.length > 0) {
              newMoviesToInsert.push(...movies);
              // For row, we want the collection ref, not individual episodes — use first movie's playlistId
              const first = movies[0];
              if (first.playlistId) {
                movieRefs.push(`playlist:${first.playlistId}`);
                addLog(`✨ Auto-created ${movies.length} episodes for ${data.mainTitle} (S${data.totalSeasons}) with IMDb ${imdbToUse} → playlist:${first.playlistId}`);
              } else {
                movieRefs.push(getMovieRef(first));
                movieIds.push(first.id);
                addLog(`✨ Auto-created movie: ${first.title}`);
              }
            } else {
              // Fallback single movie without episodes
              const cover = data.mainCover || data.seasons[0]?.coverImage || "";
              const single: Movie = {
                id: Date.now() + i * 1000,
                title: data.mainTitle,
                description: data.description.slice(0, 300),
                image: cover,
                backdrop: data.mainBanner || cover,
                thumbnailUrl: cover,
                year: data.seasons[0]?.year || new Date().getFullYear(),
                rating: "PG-13",
                duration: "2h",
                genre: ["Anime", ...data.genres].slice(0, 3),
                match: data.seasons[0]?.averageScore || 85,
                cast: data.seasons[0]?.studios || ["Anime Studio"],
                creator: data.seasons[0]?.studios?.[0] || "Anime",
              };
              newMoviesToInsert.push(single);
              movieRefs.push(getMovieRef(single));
              addLog(`✨ Auto-created (no IMDb) movie: ${single.title}`);
            }
          } else {
            // No IMDb — create single movie card with cover/description only (admin can add IMDb later)
            const cover = data.mainCover || data.seasons[0]?.coverImage || "";
            const single: Movie = {
              id: Date.now() + i * 1000,
              title: data.mainTitle,
              description: data.description.slice(0, 300),
              image: cover,
              backdrop: data.mainBanner || cover,
              thumbnailUrl: cover,
              year: data.seasons[0]?.year || new Date().getFullYear(),
              rating: "PG-13",
              duration: "2h",
              genre: ["Anime", ...data.genres].slice(0, 3),
              match: data.seasons[0]?.averageScore || 85,
              cast: data.seasons[0]?.studios || ["Anime Studio"],
              creator: data.seasons[0]?.studios?.[0] || "Anime",
            };
            newMoviesToInsert.push(single);
            movieRefs.push(getMovieRef(single));
            addLog(`✨ Auto-created metadata-only: ${single.title} (IMDb nahi diya, baad me add kar sakte ho)`);
          }

          // Respect Jikan rate limit
          await new Promise((r) => setTimeout(r, 600));
        } catch (e: any) {
          addLog(`❌ Failed to auto-add ${name}: ${e.message}`);
        }
      }

      // Insert new movies into Supabase
      let inserted: Movie[] = [];
      if (newMoviesToInsert.length > 0) {
        addLog(`💾 Inserting ${newMoviesToInsert.length} new movies into database...`);
        try {
          inserted = await insertMovies(newMoviesToInsert, "uploaded");
          if (inserted.length === 0) {
            // If Supabase insert fails (RLS etc), still use local movies with temp IDs for row
            inserted = newMoviesToInsert;
            addLog(`⚠️ Supabase insert returned 0, using local temp IDs (check RLS)`);
          } else {
            addLog(`✅ Inserted ${inserted.length} movies into DB`);
            // Update refs to use real inserted IDs if we used temp refs
            // For playlist refs, they are already deterministic and will match after buildCollections
          }
        } catch (e: any) {
          addLog(`❌ DB insert error: ${e.message}, using local`);
          inserted = newMoviesToInsert;
        }
      }

      // Build final refs: if we inserted movies, rebuild refs from inserted
      const finalRefs: string[] = [];
      const finalIds: number[] = [];

      // For existing movies, we already have refs
      finalRefs.push(...movieRefs);
      finalIds.push(...movieIds);

      // For newly inserted playlist movies, ensure playlist refs are included
      // (they already are in movieRefs if we used playlist:xxx)
      // For single movies, get ref from inserted
      inserted.forEach((m) => {
        if (m.playlistId) {
          const pref = `playlist:${m.playlistId}`;
          if (!finalRefs.includes(pref)) finalRefs.push(pref);
        } else {
          const ref = getMovieRef(m);
          if (!finalRefs.includes(ref)) {
            finalRefs.push(ref);
            finalIds.push(m.id);
          }
        }
      });

      // Deduplicate refs
      const uniqueRefs = Array.from(new Set(finalRefs));
      const uniqueIds = Array.from(new Set(finalIds));

      addLog(`📦 Final row will have ${uniqueRefs.length} items`);

      // Create custom row
      const newRow: CustomRow = {
        id: `row_${Date.now()}`,
        title: rowTitle.trim(),
        titleSize: "lg",
        visible: true,
        movieIds: uniqueIds,
        movieRefs: uniqueRefs,
        isLarge: isLarge,
        section: section,
      };

      const cfg = loadConfig();
      const nextRows = [...(cfg.customRows || []), newRow];
      const saved = await saveConfig({ ...cfg, customRows: nextRows }, { allowEmptyCustomRows: true });

      if (saved) {
        addLog(`🎉 Row "${rowTitle}" created in section "${section}" with ${uniqueRefs.length} movies!`);
        setCreatedRow(newRow);
        setDone(true);
        onDone?.();
      } else {
        addLog(`❌ Row save failed — Supabase RLS check karo`);
      }
    } catch (e: any) {
      addLog(`💥 Raja error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto">
      {/* Header */}
      <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Crown size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-white font-black text-sm flex items-center gap-2">
              Raja AI Agent <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">ADMIN ONLY</span>
            </h3>
            <p className="text-amber-200/60 text-[11px] mt-0.5">
              List do, row banao, jo anime nahi hai wo khud add kar dega — POPULAR MOVIES jaise rows ke liye perfect
            </p>
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="text-gray-300 text-xs font-medium mb-1.5 block flex items-center gap-2">
            <Film size={12} /> Anime / Movie List <span className="text-red-500">*</span> <span className="text-gray-500 text-[10px]">— har line pe ek naam, ya Name | ttID | provider</span>
          </label>
          <textarea
            value={listInput}
            onChange={(e) => setListInput(e.target.value)}
            placeholder={"Your Name\nSuzume | tt16428256\nA Silent Voice | tt5323662 | nxsha\nWeathering With You\nViolet Evergarden"}
            className="w-full bg-[#222] border border-gray-700 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-amber-500 transition placeholder-gray-500 resize-none min-h-[140px] font-mono"
            rows={6}
          />
          <p className="text-[10px] text-gray-500 mt-1">
            💡 Format: <span className="font-mono text-amber-300">Your Name</span> ya <span className="font-mono text-amber-300">Suzume | tt16428256</span> ya <span className="font-mono text-amber-300">A Silent Voice | tt5323662 | nxsha</span>. IMDb ID optional hai — nahi doge to sirf cover/description ayega, player baad me add kar sakte ho.
          </p>
          <p className="text-[10px] text-gray-400 mt-1">Parsed: {parsed.length} items → {parsed.map((p) => p.name).join(", ").slice(0, 100)}{parsed.length > 3 ? "..." : ""}</p>
        </div>

        <div>
          <label className="text-gray-300 text-xs font-medium mb-1.5 block">Row Title *</label>
          <input
            type="text"
            value={rowTitle}
            onChange={(e) => setRowTitle(e.target.value)}
            placeholder="POPULAR MOVIES"
            className="w-full bg-[#222] border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-amber-500 placeholder-gray-500"
          />
        </div>

        <div>
          <label className="text-gray-500 text-[10px] mb-1 block">Section (kahan dikhega)</label>
          <select
            value={section}
            onChange={(e) => setSection(e.target.value as RowSection)}
            className="w-full bg-[#222] border border-gray-700 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-amber-500 cursor-pointer"
          >
            {SECTION_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-gray-300 text-xs font-medium mb-1.5 block">Default IMDb ID <span className="text-gray-500 text-[10px]">(sab ke liye same, optional)</span></label>
          <input
            type="text"
            value={defaultImdb}
            onChange={(e) => setDefaultImdb(e.target.value)}
            placeholder="tt15765670 (optional)"
            className="w-full bg-[#222] border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-500 placeholder-gray-500 font-mono"
          />
        </div>

        <div>
          <label className="text-gray-500 text-[10px] mb-1 block">Default Provider</label>
          <select
            value={defaultProvider}
            onChange={(e) => setDefaultProvider(e.target.value)}
            className="w-full bg-[#222] border border-gray-700 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-amber-500 cursor-pointer"
          >
            {IMDB_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.hint}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 md:col-span-2">
          <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
            <input type="checkbox" checked={isLarge} onChange={(e) => setIsLarge(e.target.checked)} className="accent-amber-500" />
            Large cards (bade posters)
          </label>
          <span className="text-[10px] text-gray-500">— POPULAR MOVIES jaise rows ke liye large accha lagta hai</span>
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={loading || !rowTitle.trim() || parsed.length === 0}
        className="w-full h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 text-white text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-lg shadow-amber-500/20"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Raja kaam kar raha hai...
          </>
        ) : (
          <>
            <Crown size={16} /> Raja se Row Banao — {parsed.length} anime → {rowTitle || "ROW"}
          </>
        )}
      </button>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-black/40 p-3 max-h-[200px] overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={12} className="text-amber-400" />
            <span className="text-amber-300 text-[10px] font-bold uppercase tracking-wider">Raja Logs</span>
          </div>
          <div className="space-y-1">
            {logs.map((log, i) => (
              <p key={i} className="text-[11px] font-mono text-gray-300 leading-relaxed">{log}</p>
            ))}
          </div>
        </div>
      )}

      {done && createdRow && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-500 flex items-center justify-center">
            <Check size={20} className="text-white" />
          </div>
          <h4 className="text-white font-bold text-sm">Ho gaya bhai! 🎉</h4>
          <p className="text-green-300/70 text-xs mt-1">
            Row <span className="text-white font-bold">"{createdRow.title}"</span> section <span className="font-mono text-white">{createdRow.section}</span> me ban gaya with {createdRow.movieRefs?.length} items.
            <br />
            Jo anime library me nahi the wo Raja ne khud AniList+Jikan se fetch karke add kar diye (cover, banner, description ke saath).
          </p>
        </div>
      )}

      <div className="rounded-lg bg-[#111] border border-white/5 p-3">
        <p className="text-[10px] text-gray-500 leading-relaxed flex gap-1.5">
          <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
          <span>
            <span className="text-amber-300 font-bold">Raja</span> sirf admin ke liye hai. Tum list doge jaise <span className="font-mono text-white">Your Name, Suzume, A Silent Voice</span>, Raja pehle library me check karega, jo nahi hai usse <span className="font-mono text-white">/api/anime-auto</span> se auto-fetch karke database me daal dega, phir <span className="font-mono text-white">POPULAR MOVIES</span> naam ka row bana ke us section me laga dega. No manual add!
          </span>
        </p>
      </div>
    </div>
  );
}
