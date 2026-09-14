import { useState } from "react";
import { Wand2, Search, Film, Image as ImageIcon, Check, Loader2, Play } from "lucide-react";
import type { AutoFetchResult } from "../lib/animeAutoFetch";
import { autoFetchToMovies, ANIME_PROVIDERS } from "../lib/animeAutoFetch";
import type { Movie } from "../data";
import { getProvider } from "../lib/imdbSeries";

interface Props {
  onAddMovies: (movies: Movie[]) => void;
  onClose?: () => void;
}

export default function AnimeAutoFetchPanel({ onAddMovies }: Props) {
  const [animeName, setAnimeName] = useState("");
  const [imdbId, setImdbId] = useState("");
  const [providerId, setProviderId] = useState(ANIME_PROVIDERS[0].id);
  const [customTemplate, setCustomTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AutoFetchResult | null>(null);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set());

  const fetchAnime = async () => {
    const name = animeName.trim();
    if (!name) {
      setError("Anime ka naam likho, jaise Naruto, One Piece, Demon Slayer");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const params = new URLSearchParams({ title: name });
      if (imdbId.trim()) params.set("imdbId", imdbId.trim());
      const res = await fetch(`/api/anime-auto?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fetch failed");
      setResult(data as AutoFetchResult);
      // Select all seasons by default
      setSelectedSeasons(new Set((data as AutoFetchResult).seasons.map((s: any) => s.seasonNumber)));
    } catch (e: any) {
      setError(e.message || "Fetch failed");
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

  const handleAdd = () => {
    if (!result) return;
    const cleanImdb = imdbId.trim();
    if (!cleanImdb) {
      setError("IMDb ID dalo — jaise tt15765670 — taaki player link ban sake. Agar sirf metadata chahiye to bhi IMDb ID zaroori hai.");
      return;
    }
    // Validate imdb format (tt + digits) or numeric tmdb id
    const isValid = /^tt\d{6,10}$/.test(cleanImdb) || /^\d{1,8}$/.test(cleanImdb);
    if (!isValid) {
      setError("IMDb ID galat format hai. tt wala ID daalo jaise tt15765670 ya TMDB numeric ID.");
      return;
    }

    const provider = getProvider(providerId);
    const template = provider ? provider.template : customTemplate.trim();
    if (!template) {
      setError("Provider template missing");
      return;
    }

    const filteredResult: AutoFetchResult = {
      ...result,
      seasons: result.seasons.filter((s) => selectedSeasons.has(s.seasonNumber)),
    };
    filteredResult.totalSeasons = filteredResult.seasons.length;
    filteredResult.totalEpisodes = filteredResult.seasons.reduce((a, s) => a + s.episodes.length, 0);

    if (filteredResult.seasons.length === 0) {
      setError("Kam se kam ek season select karo");
      return;
    }

    const movies = autoFetchToMovies(filteredResult, {
      imdbId: cleanImdb,
      providerId,
      customTemplate,
    });

    if (movies.length === 0) {
      setError("Movies generate nahi hue — template check karo");
      return;
    }

    onAddMovies(movies);
  };

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-lg border border-[#ff6a00]/20 bg-[#ff6a00]/5 p-3">
        <div className="flex gap-2">
          <Wand2 size={16} className="text-[#ff6a00] mt-0.5 flex-shrink-0" />
          <div className="text-[11px] leading-relaxed text-gray-300">
            <p className="font-bold text-white text-xs mb-1">Jikan + AniList Auto-Fetch — No API Key Needed ✅</p>
            <p>
              Bas <span className="text-white font-bold">Anime ka naam</span> aur <span className="text-white font-bold">IMDb ID</span> dalo. 
              System AniList se poster, banner, description, genres fetch karega aur Jikan se har episode ka title, synopsis aur thumbnail lega. 
              Fir NHD / Nxsha template se har episode ka player link auto ban jayega — manually kuch nahi karna!
            </p>
            <p className="mt-1 text-[#ff9a4d]">Example: Name = <span className="font-mono text-white">Naruto</span>, IMDb = <span className="font-mono text-white">tt15765670</span></p>
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-gray-300 text-xs font-medium mb-1.5 block">
            Anime Name <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={animeName}
              onChange={(e) => setAnimeName(e.target.value)}
              placeholder="e.g. Demon Slayer, One Piece, Naruto"
              className="w-full bg-[#222] border border-gray-700 rounded-lg pl-9 pr-3 py-2.5 text-white text-sm outline-none focus:border-[#ff6a00] transition placeholder-gray-500"
              onKeyDown={(e) => e.key === "Enter" && fetchAnime()}
            />
          </div>
        </div>
        <div>
          <label className="text-gray-300 text-xs font-medium mb-1.5 block">
            IMDb ID <span className="text-red-500">*</span> <span className="text-gray-500 text-[10px]">(tt... ya TMDB numeric)</span>
          </label>
          <div className="relative">
            <Film size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={imdbId}
              onChange={(e) => setImdbId(e.target.value)}
              placeholder="tt15765670"
              className="w-full bg-[#222] border border-gray-700 rounded-lg pl-9 pr-3 py-2.5 text-white text-sm outline-none focus:border-[#ff6a00] transition placeholder-gray-500 font-mono"
              onKeyDown={(e) => e.key === "Enter" && fetchAnime()}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-gray-500 text-[10px] mb-1 block">Player Provider</label>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="w-full bg-[#222] border border-gray-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-[#ff6a00] cursor-pointer"
          >
            {ANIME_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.hint}
              </option>
            ))}
            <option value="custom">Custom template...</option>
          </select>
        </div>
        <div className="md:col-span-2">
          {providerId === "custom" ? (
            <div>
              <label className="text-gray-500 text-[10px] mb-1 block">Custom Template (must have {"{id}"} {"{s}"} {"{e}"})</label>
              <input
                type="text"
                value={customTemplate}
                onChange={(e) => setCustomTemplate(e.target.value)}
                placeholder="https://nhdapi.com/tv/{id}/{s}/{e}  or  https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi..."
                className="w-full bg-[#222] border border-gray-700 rounded-lg px-3 py-2 text-white text-xs outline-none focus:border-[#ff6a00] font-mono"
              />
            </div>
          ) : (
            <div className="bg-[#111] rounded-lg px-3 py-2 border border-white/5">
              <p className="text-[10px] text-gray-500">Template:</p>
              <p className="text-[11px] font-mono text-[#ff9a4d] break-all">
                {getProvider(providerId)?.template || ""}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">{getProvider(providerId)?.hint}</p>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={fetchAnime}
        disabled={loading || !animeName.trim()}
        className="w-full h-11 rounded-xl bg-gradient-to-r from-[#ff6a00] to-[#ee0979] hover:opacity-90 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Fetching from AniList + Jikan...
          </>
        ) : (
          <>
            <Wand2 size={16} /> Fetch Anime — Auto Fill Seasons & Episodes
          </>
        )}
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 text-red-400 text-xs leading-relaxed">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3 animate-fade-in">
          <div className="rounded-xl overflow-hidden border border-white/10 bg-[#111]">
            <div className="relative h-32 w-full overflow-hidden">
              {result.mainBanner ? (
                <img src={result.mainBanner} alt={result.mainTitle} className="w-full h-full object-cover opacity-60" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#ff6a00]/20 to-[#ee0979]/20" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
              <div className="absolute bottom-0 left-0 p-3 flex gap-3 items-end w-full">
                <img src={result.mainCover} alt={result.mainTitle} className="w-16 h-24 object-cover rounded-lg border border-white/10 shadow-xl flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-white font-black text-sm leading-tight truncate">{result.mainTitle}</h3>
                  <p className="text-gray-300 text-[11px] line-clamp-2 leading-relaxed mt-1">{result.description.slice(0, 180)}...</p>
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {result.genres.slice(0, 4).map((g) => (
                      <span key={g} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                        {g}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {result.totalSeasons} Season{result.totalSeasons !== 1 ? "s" : ""} • {result.totalEpisodes} Episodes • AniList + Jikan
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 space-y-3 max-h-[320px] overflow-y-auto">
              {result.seasons.map((season) => (
                <div
                  key={season.seasonNumber}
                  className={`rounded-lg border p-2.5 transition ${selectedSeasons.has(season.seasonNumber) ? "border-[#ff6a00]/40 bg-[#ff6a00]/5" : "border-white/5 bg-[#1a1a1a]"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedSeasons.has(season.seasonNumber)}
                      onChange={() => toggleSeason(season.seasonNumber)}
                      className="mt-1 w-4 h-4 rounded accent-[#ff6a00] cursor-pointer"
                    />
                    <img src={season.coverImage} alt={season.title} className="w-12 h-16 object-cover rounded-md border border-white/10 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-white text-xs font-bold truncate">S{season.seasonNumber}: {season.title}</h4>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400">{season.year || "?"}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ff6a00]/10 text-[#ff9a4d] border border-[#ff6a00]/20">
                          {season.episodes.length} ep
                        </span>
                      </div>
                      <p className="text-gray-400 text-[10px] line-clamp-2 mt-1 leading-relaxed">{season.description?.slice(0, 120) || "No description"}</p>
                      <div className="flex gap-1 mt-2 overflow-x-auto pb-1">
                        {season.episodes.slice(0, 8).map((ep) => (
                          <div key={ep.episodeNumber} className="flex-shrink-0 w-20">
                            <div className="relative w-20 h-12 rounded overflow-hidden bg-[#222] border border-white/5">
                              {ep.image ? (
                                <img src={ep.image} alt={ep.title} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon size={12} className="text-gray-600" />
                                </div>
                              )}
                              <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5">
                                <p className="text-[8px] text-white font-bold">E{ep.episodeNumber}</p>
                              </div>
                            </div>
                            <p className="text-[9px] text-gray-400 truncate mt-1">{ep.title}</p>
                          </div>
                        ))}
                        {season.episodes.length > 8 && (
                          <div className="flex-shrink-0 w-20 h-12 rounded bg-[#222] border border-white/5 flex items-center justify-center">
                            <span className="text-[10px] text-gray-500">+{season.episodes.length - 8} more</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-white/5 bg-black/20 flex items-center justify-between">
              <p className="text-[11px] text-gray-400">
                Selected: {selectedSeasons.size} season{selectedSeasons.size !== 1 ? "s" : ""} •{" "}
                {result.seasons.filter((s) => selectedSeasons.has(s.seasonNumber)).reduce((a, s) => a + s.episodes.length, 0)} episodes
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedSeasons(new Set(result.seasons.map((s) => s.seasonNumber)))}
                  className="text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded bg-white/5"
                >
                  Select All
                </button>
                <button
                  onClick={() => setSelectedSeasons(new Set())}
                  className="text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded bg-white/5"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={selectedSeasons.size === 0}
            className="w-full h-11 rounded-xl bg-[#e50914] hover:bg-[#f6121d] text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Check size={16} />
            Add {result.seasons.filter((s) => selectedSeasons.has(s.seasonNumber)).reduce((a, s) => a + s.episodes.length, 0)} Episodes to Library — Auto Cover & Details
          </button>

          <div className="bg-[#111] rounded-lg p-2.5 border border-white/5">
            <p className="text-[10px] text-gray-500 leading-relaxed flex gap-1.5">
              <Play size={10} className="mt-0.5 flex-shrink-0 text-gray-400" />
              <span>
                Har episode ka cover Jikan se ayega (agar available), warna AniList cover use hoga. Player link <span className="font-mono text-[#ff9a4d]">{getProvider(providerId)?.template.replace("{id}", imdbId || "tt...").slice(0, 60)}...</span> se banega. 
                IMDb ID + Provider template se seasons auto-play honge — koi manual link paste nahi!
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
