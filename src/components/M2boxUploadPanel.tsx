import { useState } from "react";
import {
  Check,
  Image as ImageIcon,
  Link,
  Loader2,
  MonitorPlay,
  Sparkles,
  Upload,
} from "lucide-react";
import type { Movie } from "../data";
import { buildMovieboxPageUrl, isMovieboxUrl, parseMovieboxInput } from "../lib/moviebox";

/**
 * M2 Upload — bas M2Box ka watch link, baaki sab khud
 * =====================================================
 * Admin sirf aisa link paste karta hai:
 *   https://m2box.org/movies/my-dress-up-darling-hindi-gouZSWAYUa?id=1478...&type=/movie/detail
 * "Details lao" dabane par apna /api/moviebox (mode=detail) title,
 * poster, saal, description aur genre le aata hai. Save hone par row
 * ke embedUrl me canonical M2Box watch-page URL padta hai — jise
 * PlayerOverlay pehchanta hai aur play dabane par MovieboxPagePlayer
 * khulta hai: bas player + episode grid, poori site nahi. Series ho
 * to episodes player ke andar wali list se hi badalte hain, isliye
 * poore title ke liye EK hi row kaafi hai.
 */

const GENRES = [
  "Action",
  "Adventure",
  "Anime",
  "Cartoon",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
  "War",
  "Superhero",
];

const FALLBACK_IMG =
  "https://images.pexels.com/photos/32728014/pexels-photo-32728014.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";

interface M2boxUploadPanelProps {
  onAddMovies: (movies: Movie[]) => void;
}

export default function M2boxUploadPanel({ onAddMovies }: M2boxUploadPanelProps) {
  const [link, setLink] = useState("");
  const [canonical, setCanonical] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const [title, setTitle] = useState("");
  const [poster, setPoster] = useState("");
  const [backdrop, setBackdrop] = useState("");
  const [year, setYear] = useState(2024);
  const [description, setDescription] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [info, setInfo] = useState("");

  const looksValid = link.trim() !== "" && isMovieboxUrl(link.trim().replace(/&amp;/g, "&"));

  const handleLinkChange = (val: string) => {
    setLink(val);
    setError("");
    setNote("");
    setCanonical("");
    setInfo("");
  };

  /** Link pehchano + /api/moviebox se title/poster/details le aao. */
  const fetchDetails = async () => {
    const raw = link.trim().replace(/&amp;/g, "&");
    const ref = parseMovieboxInput(raw);
    const pageUrl = buildMovieboxPageUrl(raw);
    if (!raw || !isMovieboxUrl(raw) || !pageUrl || (!ref?.subjectId && !ref?.detailPath)) {
      setError(
        "Ye M2Box ka watch link nahi lagta. m2box.org par title kholo aur address bar wala poora link paste karo — jaise https://m2box.org/movies/my-demon-hindi-...?id=8598...&type=/movie/detail",
      );
      return;
    }
    setCanonical(pageUrl);
    setFetching(true);
    setError("");
    try {
      const qs = new URLSearchParams({ mode: "detail" });
      if (ref.subjectId) qs.set("subjectId", ref.subjectId);
      if (ref.detailPath) qs.set("detailPath", ref.detailPath);
      const res = await fetch(`/api/moviebox?${qs.toString()}`);
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        title?: string;
        overview?: string;
        poster?: string;
        backdrop?: string;
        year?: number;
        genre?: string[];
        type?: string;
        seasons?: { season: number; maxEp: number }[];
      } | null;

      if (!data?.ok) {
        // Details na milein to bhi link pakka hai — title haath se bhar ke Add ho jayega.
        setNote(
          "Link pehchan gaya ✓ — lekin auto-details nahi milein (server busy?). Title neeche haath se likh do, Add ho jayega.",
        );
        return;
      }

      if (data.title) setTitle(data.title);
      if (data.poster) setPoster(data.poster);
      if (data.backdrop) setBackdrop(data.backdrop);
      if (data.year) setYear(data.year);
      if (data.overview) setDescription(data.overview.slice(0, 500));
      if (data.genre?.length) {
        setGenres(data.genre.filter((g) => GENRES.includes(g)).slice(0, 3));
      }
      const typeLabel = data.type === "tv" ? "Series" : data.type === "movie" ? "Movie" : "Title";
      const seasonLabel =
        data.seasons && data.seasons.length > 0
          ? ` • ${data.seasons.length} season${data.seasons.length > 1 ? "s" : ""} (${data.seasons
              .map((s) => `S${s.season}: ${s.maxEp} ep`)
              .join(", ")})`
          : "";
      setInfo(`${typeLabel}${seasonLabel}`);
      setNote("Details mil gayi ✓ — check karke Add kar do.");
    } catch {
      setNote(
        "Link pehchan gaya ✓ — lekin details fetch fail hui (net/server?). Title haath se likh ke Add kar sakte ho.",
      );
    } finally {
      setFetching(false);
    }
  };

  const toggleGenre = (g: string) =>
    setGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : prev.length < 3 ? [...prev, g] : prev,
    );

  const handleAdd = () => {
    if (!canonical || !title.trim()) return;
    const movie: Movie = {
      id: Date.now(),
      title: title.trim(),
      description: description.trim() || title.trim(),
      image: poster || FALLBACK_IMG,
      backdrop: backdrop || poster || undefined,
      year,
      rating: "PG-13",
      duration: "Unknown",
      genre: genres.length > 0 ? genres : ["Uploaded"],
      match: 99,
      cast: ["User Upload"],
      creator: "You",
      // Yahi jadoo hai: embedUrl me M2Box watch link → play dabane par
      // sirf player + episode grid khulta hai (MovieboxPagePlayer).
      embedUrl: canonical,
      embedPlatform: "M2Box",
      thumbnailUrl: poster || undefined,
    };
    onAddMovies([movie]);
  };

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div className="flex items-start gap-3 rounded-lg border border-[#ff6a00]/30 bg-[#ff6a00]/5 p-3">
        <MonitorPlay size={20} className="text-[#ff6a00] mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-white text-sm font-bold">M2 Upload — bas M2Box link daalo</p>
          <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">
            m2box.org ka koi bhi movie/series link paste karo. Title, poster sab khud aa jayega.
            Play karne par <b className="text-gray-200">sirf player + episode list</b> khulegi —
            M2Box ki poori website nahi.
          </p>
        </div>
      </div>

      {/* Link input */}
      <div>
        <label className="text-gray-300 text-sm font-medium mb-2 block">
          M2Box Link <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <div className="absolute left-3 top-3 text-gray-500">
            <Link size={16} />
          </div>
          <textarea
            value={link}
            onChange={(e) => handleLinkChange(e.target.value)}
            placeholder={
              "https://m2box.org/movies/my-dress-up-darling-hindi-gouZSWAYUa?id=147811307008524432&type=/movie/detail"
            }
            className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 pl-10 text-white text-sm outline-none focus:border-[#ff6a00] transition-colors placeholder-gray-500 resize-none min-h-[64px] font-mono text-xs"
            rows={3}
          />
        </div>
        {looksValid && !canonical && (
          <p className="text-emerald-400 text-xs mt-1.5 flex items-center gap-1">
            <Check size={13} /> M2Box link lag raha hai — “Details lao” dabao.
          </p>
        )}
        {error && <p className="text-red-500 text-xs mt-1.5 leading-relaxed">{error}</p>}
        <button
          type="button"
          onClick={() => void fetchDetails()}
          disabled={fetching || !link.trim()}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white text-sm font-bold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {fetching ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {fetching ? "Details aa rahi hain…" : "Details lao (auto)"}
        </button>
        {note && <p className="text-amber-300/90 text-xs mt-2 leading-relaxed">{note}</p>}
        {info && <p className="text-gray-400 text-xs mt-1">{info}</p>}
      </div>

      {/* Details (auto bhare jaate hain, haath se badal bhi sakte ho) */}
      {canonical && (
        <div className="space-y-4 rounded-lg bg-[#111] p-4">
          <div className="flex items-start gap-4">
            <div className="w-24 h-36 rounded overflow-hidden bg-[#222] border border-gray-700 flex-shrink-0 flex items-center justify-center">
              {poster ? (
                <img src={poster} alt="Poster" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={22} className="text-gray-600" />
              )}
            </div>
            <div className="flex-1 space-y-3 min-w-0">
              <div>
                <label className="text-gray-400 text-xs font-medium mb-1 block">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. My Dress-Up Darling [Hindi]"
                  className="w-full bg-[#333] border border-gray-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-[#ff6a00] transition-colors placeholder-gray-500"
                  maxLength={100}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3">
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">
                    Poster URL <span className="text-gray-600">(optional)</span>
                  </label>
                  <input
                    type="url"
                    value={poster}
                    onChange={(e) => setPoster(e.target.value)}
                    placeholder="https://…/poster.jpg"
                    className="w-full bg-[#333] border border-gray-600 rounded px-3 py-2 text-white text-xs font-mono outline-none focus:border-[#ff6a00] transition-colors placeholder-gray-500"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Year</label>
                  <input
                    type="number"
                    value={year}
                    onChange={(e) =>
                      setYear(Math.min(2030, Math.max(1900, Number(e.target.value) || 2024)))
                    }
                    className="w-full bg-[#333] border border-gray-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-[#ff6a00] transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="text-gray-400 text-xs font-medium mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this about?"
              rows={3}
              className="w-full bg-[#333] border border-gray-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-[#ff6a00] transition-colors placeholder-gray-500 resize-none"
              maxLength={500}
            />
          </div>

          <div>
            <label className="text-gray-400 text-xs font-medium mb-1.5 block">
              Genres <span className="text-gray-600">(up to 3)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGenre(g)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${genres.includes(g) ? "bg-[#ff6a00] text-white" : "bg-[#333] text-gray-300 hover:bg-[#444]"}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleAdd}
              disabled={!title.trim()}
              className="inline-flex items-center gap-2 px-6 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload size={15} /> Add — sirf player khulega
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
