import { useState } from "react";
import { Zap, Search, Loader2, Check, Tv } from "lucide-react";
import type { Movie } from "../data";
import { fetchNxshaDirect, nxshaResultToMovies, type NxshaFetchOut } from "../lib/nxshaFetch";
import { IMDB_PROVIDERS, CUSTOM_PROVIDER_ID, getProvider } from "../lib/imdbSeries";

interface Props {
  onAddMovies: (movies: Movie[]) => void;
}

/**
 * Nxsha Direct Fetch — TMDB link/ID/naam daalo, episodes SEEDHE Nxsha ke
 * catalogue (TMDB mirror) se aate hain. AniList/Jikan bilkul use nahi hota,
 * isliye episode count kabhi galat nahi hota aur ye anime + har TV series
 * dono ke liye kaam karta hai.
 */
export default function NxshaFetchPanel({ onAddMovies }: Props) {
  const [query, setQuery] = useState("");
  const [includeSpecials, setIncludeSpecials] = useState(false);
  const [providerId, setProviderId] = useState(IMDB_PROVIDERS[0].id);
  const [customTemplate, setCustomTemplate] = useState("");
  const [markAnime, setMarkAnime] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<NxshaFetchOut | null>(null);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set());

  const doFetch = async () => {
    const q = query.trim();
    if (!q) {
      setError("TMDB link, Nxsha link, TMDB ID ya show ka naam daalo");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchNxshaDirect(q, includeSpecials);
      setResult(data);
      setSelectedSeasons(
        new Set(data.seasons.filter((s) => s.airedCount > 0).map((s) => s.seasonNumber)),
      );
      // Animation genre ho to Anime category default ON, warna OFF
      setMarkAnime(data.genres.some((g) => /animation|anime/i.test(g)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  };

  const toggleSeason = (num: number) => {
    setSelectedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  };

  const selectedCount = result
    ? result.seasons
        .filter((s) => selectedSeasons.has(s.seasonNumber))
        .reduce((a, s) => a + s.episodes.length, 0)
    : 0;

  const handleAdd = () => {
    if (!result) return;
    if (providerId === CUSTOM_PROVIDER_ID && !customTemplate.includes("{id}")) {
      setError("Custom template me {id} {s} {e} placeholders chahiye");
      return;
    }
    const movies = nxshaResultToMovies(result, {
      providerId: providerId === CUSTOM_PROVIDER_ID ? undefined : providerId,
      customTemplate: providerId === CUSTOM_PROVIDER_ID ? customTemplate : undefined,
      markAnime,
      selectedSeasons,
    });
    if (movies.length === 0) {
      setError("Koi episode select nahi hua");
      return;
    }
    onAddMovies(movies);
  };

  return (
    <div className="bg-gradient-to-br from-[#1a0f00] to-[#141414] border border-[#ff6a00]/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Zap size={16} className="text-[#ff6a00]" />
        <h3 className="text-white text-sm font-bold">Nxsha Direct Fetch</h3>
        <span className="text-[9px] uppercase tracking-wide bg-[#ff6a00]/20 text-[#ff9a4d] px-1.5 py-0.5 rounded font-bold">
          Recommended
        </span>
      </div>
      <p className="text-gray-400 text-[11px] leading-relaxed">
        Episodes <span className="text-[#ff9a4d] font-semibold">seedhe Nxsha ke catalogue</span>{" "}
        (TMDB mirror) se — exact wahi list jo nxsha.space ke player me dikhti hai. Sirf aired
        episodes aate hain, isliye count kabhi galat nahi hota. Anime + koi bhi TV series.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && doFetch()}
          placeholder="TMDB link (themoviedb.org/tv/312949) / Nxsha link / TMDB ID / naam"
          className="flex-1 bg-[#222] border border-gray-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-[#ff6a00] placeholder-gray-500"
        />
        <button
          onClick={doFetch}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-[#ff6a00] text-white text-xs font-bold hover:bg-[#ff8324] transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          {loading ? "Fetching…" : "Fetch"}
        </button>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={includeSpecials}
          onChange={(e) => setIncludeSpecials(e.target.checked)}
          className="accent-[#ff6a00]"
        />
        Season 0 (Specials) bhi lao
      </label>

      {error && (
        <p className="text-red-400 text-[11px] bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          {/* Show header */}
          <div className="flex gap-3 bg-[#111] rounded-lg p-3 border border-white/5">
            {result.poster && (
              <img
                src={result.poster}
                alt={result.title}
                className="w-14 h-20 object-cover rounded-md flex-shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="text-white text-sm font-bold truncate">
                {result.title}{" "}
                {result.year ? (
                  <span className="text-gray-500 font-normal">({result.year})</span>
                ) : null}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                TMDB #{result.tmdbId} • {result.totalSeasons} season
                {result.totalSeasons > 1 ? "s" : ""} •{" "}
                <span className="text-[#ff9a4d]">{result.totalAired} aired</span>
                {result.totalEpisodes > result.totalAired
                  ? ` / ${result.totalEpisodes} total (baaki abhi air nahi hue)`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {result.genres.slice(0, 4).map((g) => (
                  <span
                    key={g}
                    className="text-[9px] bg-white/5 text-gray-400 px-1.5 py-0.5 rounded"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Seasons */}
          <div className="space-y-1.5">
            {result.seasons.map((season) => (
              <button
                key={season.seasonNumber}
                onClick={() => toggleSeason(season.seasonNumber)}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 border text-left transition-colors ${
                  selectedSeasons.has(season.seasonNumber)
                    ? "bg-[#ff6a00]/10 border-[#ff6a00]/40"
                    : "bg-[#111] border-white/5 hover:border-white/15"
                }`}
              >
                <span className="flex items-center gap-2 text-xs text-white">
                  <Tv size={12} className="text-gray-500" />
                  {season.seasonNumber === 0 ? "Specials (S0)" : `Season ${season.seasonNumber}`}
                  <span className="text-[10px] text-gray-500">
                    {season.airedCount} aired
                    {season.episodesCount > season.airedCount ? ` / ${season.episodesCount}` : ""}
                  </span>
                </span>
                {selectedSeasons.has(season.seasonNumber) && (
                  <Check size={14} className="text-[#ff6a00]" />
                )}
              </button>
            ))}
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={markAnime}
                onChange={(e) => setMarkAnime(e.target.checked)}
                className="accent-[#ff6a00]"
              />
              Anime category me dikhao
            </label>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="bg-[#222] border border-gray-700 rounded px-2 py-1 text-white text-[11px] outline-none focus:border-[#ff6a00] cursor-pointer"
            >
              {IMDB_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  Player: {p.name}
                </option>
              ))}
              <option value={CUSTOM_PROVIDER_ID}>Player: Custom…</option>
            </select>
          </div>
          {providerId === CUSTOM_PROVIDER_ID && (
            <input
              type="text"
              value={customTemplate}
              onChange={(e) => setCustomTemplate(e.target.value)}
              placeholder="https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true"
              className="w-full bg-[#222] border border-gray-700 rounded-lg px-3 py-2 text-white text-[11px] font-mono outline-none focus:border-[#ff6a00] placeholder-gray-600"
            />
          )}

          <button
            onClick={handleAdd}
            disabled={selectedCount === 0}
            className="w-full py-2.5 rounded-lg bg-[#ff6a00] hover:bg-[#ff8324] text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add {selectedCount} Episode{selectedCount === 1 ? "" : "s"} — Nxsha Player ke saath
          </button>
          <p className="text-[10px] text-gray-600 font-mono truncate">
            {(getProvider(providerId)?.template || customTemplate || "")
              .replace("{id}", result.tmdbId)
              .replace("{s}", String(result.seasons[0]?.seasonNumber ?? 1))
              .replace("{e}", "1")}
          </p>
        </div>
      )}
    </div>
  );
}
