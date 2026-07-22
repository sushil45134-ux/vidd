import { useState, useEffect } from "react";
import { X, Sparkles, Loader, Check, Plus, Trash2 } from "lucide-react";
import type { Movie } from "../data";
import { analyzeVideo, type AiAnalysis } from "../utils/aiAnalyze";

interface AiAssistantProps {
  onClose: () => void;
  onAdd: (movies: Movie | Movie[]) => void;
}

interface VideoInfo { videoId: string; title: string; author: string; thumbnail: string; }

async function fetchVideoInfo(videoId: string): Promise<VideoInfo | null> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return { videoId, title: data.title || "", author: data.author_name || "", thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` };
  } catch { return null; }
}

function extractYoutubeId(input: string): string | null {
  const patterns = [/(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([A-Za-z0-9_-]{11})/, /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/, /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/, /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/];
  for (const p of patterns) { const m = input.match(p); if (m) return m[1]; }
  if (/^[A-Za-z0-9_-]{11}$/.test(input.trim())) return input.trim();
  return null;
}

export default function AiAssistant({ onClose, onAdd }: AiAssistantProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<{ info: VideoInfo; analysis: AiAnalysis }[]>([]);
  const [step, setStep] = useState<"input" | "results" | "done">("input");

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = "auto"; }; }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  const doAnalyze = async () => {
    const lines = input.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) { setError("Paste YouTube video URLs or IDs"); return; }
    setLoading(true); setError("");
    const r: typeof results = [];
    for (const line of lines) {
      const id = extractYoutubeId(line); if (!id) continue;
      const info = await fetchVideoInfo(id); if (!info) continue;
      r.push({ info, analysis: analyzeVideo(info.title, info.author) });
    }
    if (!r.length) setError("Could not fetch any video info.");
    else { setResults(r); setStep("results"); }
    setLoading(false);
  };

  const doAdd = () => {
    const movies: Movie[] = results.map((r, i) => ({
      id: Date.now() + i, title: r.analysis.detectedTitle, description: r.analysis.description,
      image: r.info.thumbnail, backdrop: `https://img.youtube.com/vi/${r.info.videoId}/maxresdefault.jpg`,
      year: r.analysis.year, rating: r.analysis.rating, duration: "Unknown",
      genre: r.analysis.genres, match: r.analysis.confidence, cast: [r.info.author], creator: r.info.author,
      youtubeId: r.info.videoId, thumbnailUrl: r.info.thumbnail, embedPlatform: "YouTube",
    }));
    setStep("done");
    setTimeout(() => onAdd(movies.length === 1 ? movies[0] : movies), 1500);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/80 backdrop-blur-sm overflow-y-auto pt-6 pb-6" onClick={onClose}>
      <div className="relative w-full max-w-2xl mx-4 bg-[#181818] rounded-lg overflow-hidden shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"><Sparkles size={18} className="text-white" /></div>
            <div><h2 className="text-white text-lg font-bold">AI Video Analyzer</h2><p className="text-gray-500 text-[10px]">Auto-detect title, genre, category & more</p></div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center hover:bg-[#3a3a3a]"><X size={18} className="text-white" /></button>
        </div>

        {step === "input" && (
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-4">Paste YouTube URLs and AI will auto-detect title, category, genres, rating, year, and description.</p>
            <textarea value={input} onChange={e => { setInput(e.target.value); setError(""); }}
              placeholder={"Paste YouTube URLs:\nhttps://www.youtube.com/watch?v=xxxxx\nhttps://youtu.be/xxxxx"}
              className="w-full bg-[#333] border border-gray-600 rounded px-4 py-3 text-white text-sm outline-none focus:border-purple-500 placeholder-gray-500 resize-none min-h-[120px]" rows={5} />
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            <div className="flex justify-end mt-4">
              <button onClick={doAnalyze} disabled={loading || !input.trim()}
                className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-bold hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 flex items-center gap-2">
                {loading ? <Loader size={16} className="animate-spin" /> : <Sparkles size={16} />} {loading ? "Analyzing..." : "Analyze with AI"}
              </button>
            </div>
          </div>
        )}

        {step === "results" && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-white text-sm font-medium">{results.length} video{results.length !== 1 ? "s" : ""} analyzed</p>
              <button onClick={() => setStep("input")} className="text-gray-400 text-xs hover:text-white">← More</button>
            </div>
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 mb-5">
              {results.map(({ info, analysis }) => (
                <div key={info.videoId} className="bg-[#222] rounded-lg overflow-hidden border border-gray-700/50">
                  <div className="flex items-start gap-3 p-3">
                    <img src={info.thumbnail} alt="" className="w-28 h-16 object-cover rounded flex-shrink-0 bg-gray-800" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium line-clamp-2">{analysis.detectedTitle}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{info.author}</p>
                    </div>
                    <button onClick={() => setResults(prev => prev.filter(r => r.info.videoId !== info.videoId))} className="text-gray-600 hover:text-red-500 flex-shrink-0 mt-1"><Trash2 size={14} /></button>
                  </div>
                  <div className="px-3 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles size={12} className="text-purple-400" />
                      <span className="text-purple-400 text-[10px] font-bold uppercase tracking-wider">AI Analysis</span>
                      <span className="text-green-400 text-[10px] font-bold">{analysis.confidence}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <div className="flex items-center gap-2"><span className="text-gray-500 w-16">Category</span><span className={`font-bold px-2 py-0.5 rounded text-[10px] ${analysis.category === "Anime" ? "bg-purple-500/20 text-purple-300" : analysis.category === "Cartoon" ? "bg-cyan-500/20 text-cyan-300" : "bg-blue-500/20 text-blue-300"}`}>{analysis.category === "Movie" ? "🎬" : analysis.category === "Anime" ? "⛩️" : "🎨"} {analysis.category}</span></div>
                      <div className="flex items-center gap-2"><span className="text-gray-500 w-16">Rating</span><span className="text-white border border-gray-600 px-1.5 py-0.5 rounded text-[10px]">{analysis.rating}</span></div>
                      <div className="flex items-center gap-2"><span className="text-gray-500 w-16">Year</span><span className="text-gray-300">{analysis.year}</span></div>
                      <div className="flex items-center gap-2"><span className="text-gray-500 w-16">Genres</span><span className="text-gray-300 truncate">{analysis.genres.join(", ")}</span></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep("input")} className="text-gray-300 text-sm hover:text-white">← Back</button>
              <button onClick={doAdd} className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-bold flex items-center gap-2">
                <Plus size={16} /> Add {results.length} Video{results.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="p-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-4 animate-bounce"><Check size={32} className="text-white" /></div>
            <h3 className="text-white text-xl font-bold mb-2">Added!</h3>
            <p className="text-gray-400 text-sm">{results.length} video{results.length !== 1 ? "s" : ""} analyzed and added.</p>
          </div>
        )}
      </div>
    </div>
  );
}
