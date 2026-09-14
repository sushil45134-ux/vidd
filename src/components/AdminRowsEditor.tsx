import { useEffect, useState, useMemo, useRef } from "react";
import {
  X,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Check,
  Download,
  Loader2,
  Square,
} from "lucide-react";
import type { Movie } from "../data";
import {
  loadConfig,
  getMovieRef,
  saveConfig,
  type CustomRow,
  type TitleSize,
  type RowSection,
} from "../lib/customization";
import { matchPlannedTitle, parsePlannedTitles } from "../lib/plannedRows";
import { autoAddPlannedTitles, type TitleAddStatus } from "../lib/wishlistAutoAdd";
import { ANIME_PROVIDERS } from "../lib/animeAutoFetch";

interface Props {
  onClose: () => void;
  availableMovies: Movie[];
  onAddMovies: (movies: Movie[]) => Promise<void> | void;
}

const SIZE_OPTIONS: { value: TitleSize; label: string }[] = [
  { value: "xs", label: "XS" },
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
  { value: "xl", label: "XL" },
  { value: "2xl", label: "2XL" },
];

const SECTION_OPTIONS: { value: RowSection; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "movies", label: "Movies" },
  { value: "anime", label: "Anime" },
  { value: "cartoon", label: "Cartoon" },
  { value: "tvshows", label: "TV Shows" },
  { value: "new", label: "New" },
  { value: "mylist", label: "My List" },
  { value: "all", label: "All Sections" },
];

function getMovieIds(movie: Movie): number[] {
  return [movie.id, ...(movie.episodes?.map((episode) => episode.id) || [])];
}

export default function AdminRowsEditor({ onClose, availableMovies, onAddMovies }: Props) {
  const [rows, setRows] = useState<CustomRow[]>(() => loadConfig().customRows || []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [autoAddProvider, setAutoAddProvider] = useState(ANIME_PROVIDERS[0].id);
  const [autoAdding, setAutoAdding] = useState(false);
  const [addStatuses, setAddStatuses] = useState<Record<string, TitleAddStatus>>({});
  const [lastSummary, setLastSummary] = useState<{
    added: number;
    failed: number;
    skipped: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startAutoAdd = async (targets: string[]) => {
    if (autoAdding || targets.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAutoAdding(true);
    setAddStatuses({});
    setLastSummary(null);
    try {
      const { movies, added, failed, skipped } = await autoAddPlannedTitles(targets, {
        providerId: autoAddProvider,
        signal: ctrl.signal,
        onStatus: (s) => setAddStatuses((prev) => ({ ...prev, [s.title]: s })),
      });
      if (movies.length > 0) await onAddMovies(movies);
      setLastSummary({ added, failed, skipped });
    } finally {
      setAutoAdding(false);
      abortRef.current = null;
    }
  };

  const stopAutoAdd = () => abortRef.current?.abort();

  function persist(next: CustomRow[]) {
    setRows(next);
    const cfg = loadConfig();
    void saveConfig({ ...cfg, customRows: next }, { allowEmptyCustomRows: true });
  }

  function addRow() {
    const id = `row_${Date.now()}`;
    const next: CustomRow = {
      id,
      title: "New Row",
      titleSize: "lg",
      visible: true,
      movieIds: [],
      movieRefs: [],
      isLarge: false,
      section: "all",
    };
    persist([...rows, next]);
    setEditingId(id);
  }

  function updateRow(id: string, patch: Partial<CustomRow>) {
    persist(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function deleteRow(id: string) {
    if (!confirm("Delete this row?")) return;
    persist(rows.filter((r) => r.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function move(id: string, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[idx], next[to]] = [next[to], next[idx]];
    persist(next);
  }

  useEffect(() => {
    let changed = false;
    const next = rows.map((row) => {
      const refs = new Set(row.movieRefs || []);
      row.movieIds.forEach((id) => {
        const movie = availableMovies.find((m) => m.id === id);
        if (!movie) return;
        const ref = getMovieRef(movie);
        if (!refs.has(ref)) {
          refs.add(ref);
          changed = true;
        }
      });
      return changed ? { ...row, movieRefs: Array.from(refs) } : row;
    });
    if (changed) persist(next);
  }, [availableMovies, rows]);

  function toggleMovie(rowId: string, movie: Movie) {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const ref = getMovieRef(movie);
    const refs = row.movieRefs || [];
    const movieIds = getMovieIds(movie);
    const has = movieIds.some((id) => row.movieIds.includes(id)) || refs.includes(ref);
    updateRow(rowId, {
      movieIds: has
        ? row.movieIds.filter((x) => !movieIds.includes(x))
        : [...row.movieIds, movie.id],
      movieRefs: has ? refs.filter((x) => x !== ref) : [...refs, ref],
    });
  }

  const editing = rows.find((r) => r.id === editingId) || null;

  const filteredMovies = useMemo(() => {
    if (!search.trim()) return availableMovies;
    const q = search.toLowerCase();
    return availableMovies.filter((m) => m.title.toLowerCase().includes(q));
  }, [search, availableMovies]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#111] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-black text-white">
              <span className="bg-gradient-to-r from-[#ff6a00] to-[#ff8533] bg-clip-text text-transparent">
                Custom
              </span>{" "}
              Rows
            </h2>
            <p className="text-xs text-white/40 mt-0.5">
              Add rows visible to everyone on the site.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
          {/* Left: rows list */}
          <div className="border-r border-white/10 overflow-y-auto p-4 space-y-2">
            <button
              onClick={addRow}
              className="w-full h-10 rounded-xl bg-gradient-to-r from-[#ff6a00] to-[#ee0979] hover:opacity-90 text-white text-sm font-bold flex items-center justify-center gap-2 transition"
            >
              <Plus size={16} /> Add New Row
            </button>

            {rows.length === 0 && (
              <p className="text-white/30 text-xs text-center py-8">No custom rows yet.</p>
            )}

            {rows.map((r, i) => (
              <div
                key={r.id}
                onClick={() => setEditingId(r.id)}
                className={`p-3 rounded-xl border cursor-pointer transition ${
                  editingId === r.id
                    ? "bg-white/10 border-[#ff6a00]/50"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold truncate">
                      {r.title || <span className="text-white/40 italic">Untitled</span>}
                    </div>
                    <div className="text-[10px] text-white/40 mt-0.5">
                      {r.movieRefs?.length || r.movieIds.length} item
                      {(r.movieRefs?.length || r.movieIds.length) !== 1 ? "s" : ""} · size{" "}
                      {r.titleSize.toUpperCase()} · {r.visible ? "visible" : "hidden"}
                      {(r.plannedTitles?.length || 0) > 0 && (
                        <span className="ml-1.5 text-emerald-400">
                          · {(r.plannedTitles || []).length} planned
                        </span>
                      )}
                      {(r.movieRefs?.length || r.movieIds.length) === 0 &&
                        (r.plannedTitles?.length || 0) === 0 && (
                          <span className="ml-1.5 text-[#ff6a00]">
                            · no movies — won&apos;t show on site
                          </span>
                        )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        move(r.id, -1);
                      }}
                      disabled={i === 0}
                      className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70 flex items-center justify-center"
                      title="Move up"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        move(r.id, 1);
                      }}
                      disabled={i === rows.length - 1}
                      className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70 flex items-center justify-center"
                      title="Move down"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateRow(r.id, { visible: !r.visible });
                      }}
                      className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 flex items-center justify-center"
                      title={r.visible ? "Hide" : "Show"}
                    >
                      {r.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRow(r.id);
                      }}
                      className="w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: editor */}
          <div className="overflow-y-auto p-4">
            {!editing ? (
              <p className="text-white/40 text-sm text-center py-16">
                Select a row on the left, or add a new one.
              </p>
            ) : (
              <div className="space-y-4">
                {(editing.movieRefs?.length || editing.movieIds.length) === 0 &&
                  (editing.plannedTitles?.length || 0) === 0 && (
                    <div className="rounded-xl bg-[#ff6a00]/10 border border-[#ff6a00]/30 px-3 py-2 text-xs text-[#ff6a00]">
                      This row won&apos;t appear on the site until you add a movie or a planned
                      title below.
                    </div>
                  )}
                <div>
                  <label className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                    Row Title
                  </label>
                  <input
                    value={editing.title}
                    onChange={(e) => updateRow(editing.id, { title: e.target.value })}
                    placeholder="e.g. My Favorites"
                    className="mt-1 w-full h-10 bg-white/5 border border-white/10 rounded-xl px-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#ff6a00]/50"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                    Title Size
                  </label>
                  <div className="mt-1 flex gap-1">
                    {SIZE_OPTIONS.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => updateRow(editing.id, { titleSize: s.value })}
                        className={`flex-1 h-9 rounded-lg text-xs font-bold transition ${
                          editing.titleSize === s.value
                            ? "bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white"
                            : "bg-white/5 hover:bg-white/10 text-white/70"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                    Show On Section
                  </label>
                  <div className="mt-1 grid grid-cols-4 gap-1">
                    {SECTION_OPTIONS.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => updateRow(editing.id, { section: s.value })}
                        className={`h-9 rounded-lg text-[11px] font-bold transition ${
                          (editing.section || "home") === s.value
                            ? "bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white"
                            : "bg-white/5 hover:bg-white/10 text-white/70"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editing.isLarge || false}
                      onChange={(e) => updateRow(editing.id, { isLarge: e.target.checked })}
                      className="accent-[#ff6a00]"
                    />
                    Large cards
                  </label>
                  <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editing.visible}
                      onChange={(e) => updateRow(editing.id, { visible: e.target.checked })}
                      className="accent-[#ff6a00]"
                    />
                    Visible to public
                  </label>
                </div>

                <div>
                  <label className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                    Planned Titles — wishlist ({(editing.plannedTitles || []).length})
                  </label>
                  <p className="text-[11px] text-white/40 mt-1">
                    One anime per line. Matched titles play from your library; missing ones show as
                    Coming Soon slots and fill in automatically when you add them. While this list
                    is set, it defines the row (manual picks below are ignored).
                  </p>
                  <textarea
                    value={(editing.plannedTitles || []).join("\n")}
                    onChange={(e) =>
                      updateRow(editing.id, { plannedTitles: parsePlannedTitles(e.target.value) })
                    }
                    placeholder={"One Piece\nNaruto: Shippuden\nDemon Slayer"}
                    rows={6}
                    className="mt-1 w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#ff6a00]/50 font-mono"
                  />
                  {(editing.plannedTitles || []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {(editing.plannedTitles || []).map((t) => {
                        const m = matchPlannedTitle(t, availableMovies);
                        return (
                          <div key={t} className="flex items-center gap-2 text-[11px]">
                            {m ? (
                              <>
                                <Check size={12} className="text-emerald-400 shrink-0" />
                                <span className="text-white/70 truncate">{t}</span>
                                <span className="text-white/30 truncate">→ {m.title}</span>
                              </>
                            ) : (
                              <>
                                <span className="w-3 h-3 rounded-full border border-white/25 shrink-0" />
                                <span className="text-white/70 truncate">{t}</span>
                                <span className="text-[#ff6a00]/80">· Coming Soon slot</span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {(() => {
                    const missing = (editing.plannedTitles || []).filter(
                      (t) => !matchPlannedTitle(t, availableMovies),
                    );
                    if (missing.length === 0) return null;
                    const finished = missing.filter((t) => {
                      const s = addStatuses[t];
                      return !!s && s.phase !== "fetching";
                    }).length;
                    return (
                      <div className="mt-3 rounded-xl border border-[#ff6a00]/30 bg-[#ff6a00]/5 p-3">
                        <p className="text-[11px] text-white/70 leading-relaxed">
                          <span className="font-bold text-white">{missing.length} missing</span> —
                          naam se ID aur episodes auto-fetch karke library me add karo. Row me list
                          ke order me khud dikhenge. Koi API key nahi chahiye.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={autoAddProvider}
                            onChange={(e) => setAutoAddProvider(e.target.value)}
                            disabled={autoAdding}
                            className="bg-[#222] border border-white/10 rounded-lg px-2 py-1.5 text-white text-[11px] outline-none focus:border-[#ff6a00] cursor-pointer disabled:opacity-50"
                          >
                            {ANIME_PROVIDERS.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          {!autoAdding ? (
                            <button
                              onClick={() => void startAutoAdd(missing)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#ff6a00] to-[#ee0979] hover:opacity-90 text-white text-[11px] font-bold transition"
                            >
                              <Download size={13} /> Auto-add {missing.length} to library
                            </button>
                          ) : (
                            <button
                              onClick={stopAutoAdd}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[11px] font-bold transition"
                            >
                              <Square size={13} /> Roko ({finished}/{missing.length})
                            </button>
                          )}
                        </div>
                        {autoAdding && (
                          <div className="mt-2 h-1 rounded bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-[#ff6a00] transition-all"
                              style={{ width: `${Math.round((finished / missing.length) * 100)}%` }}
                            />
                          </div>
                        )}
                        {(autoAdding || Object.keys(addStatuses).length > 0) && (
                          <div className="mt-2 space-y-1">
                            {missing.map((t) => {
                              const s = addStatuses[t];
                              if (!s || s.phase === "fetching") {
                                return (
                                  <div
                                    key={t}
                                    className="flex items-center gap-2 text-[11px] text-white/50"
                                  >
                                    {!s ? (
                                      <span className="w-3 h-3 rounded-full border border-white/25 shrink-0" />
                                    ) : (
                                      <Loader2 size={12} className="animate-spin shrink-0" />
                                    )}
                                    <span className="truncate">{t}</span>
                                    <span className="shrink-0">
                                      · {!s ? "intezaar..." : "ID + episodes..."}
                                    </span>
                                  </div>
                                );
                              }
                              if (s.phase === "done") {
                                return (
                                  <div
                                    key={t}
                                    className="flex items-center gap-2 text-[11px] text-white/70"
                                  >
                                    <Check size={12} className="text-emerald-400 shrink-0" />
                                    <span className="truncate">{t}</span>
                                    <span className="text-white/30 truncate">
                                      → {s.detail} · {s.episodes} eps · {s.imdbId}
                                    </span>
                                  </div>
                                );
                              }
                              if (s.phase === "failed") {
                                return (
                                  <div
                                    key={t}
                                    className="flex items-center gap-2 text-[11px] text-white/70"
                                  >
                                    <X size={12} className="text-red-400 shrink-0" />
                                    <span className="truncate">{t}</span>
                                    <span className="text-red-400/80 truncate">· {s.detail}</span>
                                  </div>
                                );
                              }
                              return (
                                <div
                                  key={t}
                                  className="flex items-center gap-2 text-[11px] text-white/40"
                                >
                                  <span className="w-3 h-3 rounded-full border border-white/25 shrink-0" />
                                  <span className="truncate">{t}</span>
                                  <span className="truncate">· {s.detail || "skip"}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {!autoAdding && lastSummary && (
                          <p className="mt-2 text-[11px] text-white/70">
                            ✅ {lastSummary.added} added
                            {lastSummary.failed > 0 && ` · ❌ ${lastSummary.failed} failed`}
                            {lastSummary.skipped > 0 && ` · ⏭ ${lastSummary.skipped} skipped`} —
                            added anime row me list ke order me khud dikhenge.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <label className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                    Pick Movies ({editing.movieRefs?.length || editing.movieIds.length} selected)
                  </label>
                  {(editing.plannedTitles?.length || 0) > 0 && (
                    <p className="text-[11px] text-[#ff6a00]/90 mt-1">
                      Planned list is active — manual picks are ignored. Clear the wishlist above to
                      use manual picks.
                    </p>
                  )}
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="mt-1 w-full h-9 bg-white/5 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#ff6a00]/50"
                  />
                  <div className="mt-2 max-h-72 overflow-y-auto space-y-1 pr-1">
                    {filteredMovies.length === 0 && (
                      <p className="text-white/30 text-xs py-4 text-center">
                        No movies available. Upload or sync content first.
                      </p>
                    )}
                    {filteredMovies.map((m) => {
                      const selected =
                        getMovieIds(m).some((id) => editing.movieIds.includes(id)) ||
                        (editing.movieRefs || []).includes(getMovieRef(m));
                      return (
                        <button
                          key={m.id}
                          onClick={() => toggleMovie(editing.id, m)}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition ${
                            selected
                              ? "bg-[#ff6a00]/15 ring-1 ring-[#ff6a00]/40"
                              : "bg-white/5 hover:bg-white/10"
                          }`}
                        >
                          <img
                            src={m.image}
                            alt=""
                            className="w-12 h-8 rounded object-cover shrink-0"
                          />
                          <span className="flex-1 text-xs text-white truncate">{m.title}</span>
                          {selected && <Check size={14} className="text-[#ff6a00]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between">
          <p className="text-[11px] text-white/40">Changes save automatically.</p>
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
