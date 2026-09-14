import { useState, useEffect, useRef, useMemo } from "react";
import { Crown, Send, X, Sparkles, Loader2, Check, Bot, User, Wand2, Film, AlertCircle } from "lucide-react";
import type { Movie } from "../data";
import { loadConfig, saveConfig, getMovieRef, type CustomRow, type RowSection } from "../lib/customization";
import { insertMovies, fetchAllMovies } from "../lib/moviesRepo";
import { autoFetchToMovies, type AutoFetchResult } from "../lib/animeAutoFetch";
import { IMDB_PROVIDERS } from "../lib/imdbSeries";

interface ChatMessage {
  id: string;
  role: "user" | "raja" | "system";
  text: string;
  timestamp: string;
  type?: "log" | "success" | "error" | "thinking";
}

interface Props {
  onClose: () => void;
  onDone?: () => void;
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

function parseUserIntent(input: string): { animeList: string[]; rowTitle: string; section: RowSection; provider: string } {
  const lower = input.toLowerCase();
  let rowTitle = "POPULAR MOVIES";
  let section: RowSection = "movies";
  let provider = IMDB_PROVIDERS[0].id;
  let animeList: string[] = [];

  // Extract row title: "row ...", "POPULAR MOVIES", "TRENDING", etc or quoted
  const rowMatch = input.match(/(?:row|list)\s*(?:named|called|title)?\s*["']?([^"'\n]+?)["']?\s*(?:in|for|me|bana|create)?/i) ||
                   input.match(/["']([A-Z\s]+)["']/ ) ||
                   input.match(/(POPULAR MOVIES|TRENDING ANIME|TOP \d+|MUST WATCH|NEW RELEASES)/i);
  if (rowMatch) {
    rowTitle = rowMatch[1].trim().toUpperCase();
    if (rowTitle.length > 40) rowTitle = rowTitle.slice(0, 40);
  }

  // Section detection
  if (lower.includes("anime")) section = "anime";
  else if (lower.includes("movie")) section = "movies";
  else if (lower.includes("cartoon")) section = "cartoon";
  else if (lower.includes("tv show")) section = "tvshows";
  else if (lower.includes("home")) section = "home";

  // Provider
  if (lower.includes("nxsha")) provider = "nxsha";
  else if (lower.includes("nhd")) provider = "nhd";

  // Anime list: split by comma, newline, or "add X, Y, Z"
  // Try to extract after "add", "upload", "include"
  let listPart = input;
  const addMatch = input.match(/(?:add|upload|include|lagao|daalo)\s+(.+?)(?:\s+to\s+|\s+in\s+|\s+row|\s+me|$)/i);
  if (addMatch) listPart = addMatch[1];

  // Clean row title words from list
  listPart = listPart.replace(/POPULAR MOVIES|TRENDING ANIME|row|movies|anime|section|me|bana|create|list/gi, "");

  animeList = listPart
    .split(/[,;\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 80)
    .map(s => s.replace(/^(add|upload|include)\s+/i, "").trim())
    .filter(Boolean);

  // If still empty, try to find known anime names in input
  if (animeList.length === 0) {
    const known = ["violet evergarden", "your name", "suzume", "a silent voice", "demon slayer", "spy x family", "attack on titan", "naruto", "one piece", "jujutsu kaisen", "chainsaw man", "my dress-up darling", "weathering with you", "i want to eat your pancreas"];
    for (const k of known) {
      if (lower.includes(k)) animeList.push(k.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    }
  }

  // Fallback: if input is just a list like "Violet Evergarden, Your Name"
  if (animeList.length === 0) {
    animeList = input.split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 60);
  }

  // Deduplicate
  animeList = Array.from(new Set(animeList)).slice(0, 10);

  return { animeList, rowTitle, section, provider };
}

function findMovieByName(name: string, library: Movie[]): Movie | null {
  const lower = name.toLowerCase();
  let found = library.find(m => m.title.toLowerCase() === lower || (m.playlistTitle && m.playlistTitle.toLowerCase() === lower));
  if (found) return found;
  found = library.find(m => m.title.toLowerCase().includes(lower) || lower.includes(m.title.toLowerCase()));
  if (found) return found;
  return null;
}

export default function RajaChatBot({ onClose, onDone }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "raja",
      text: "Namaste! 👑 Main Raja hu, tera AI agent. Bas mujhe bol jaise:\n\n• 'Add Violet Evergarden, Your Name to POPULAR MOVIES in Movies'\n• 'Suzume aur A Silent Voice ko Trending Anime row me daal'\n• 'Violet Evergarden upload kar de'\n\nMain khud IMDb ID nikalunga, AniList+Jikan se fetch karunga, aur row bana dunga — chahe wo website pe ho ya na ho!",
      timestamp: new Date().toLocaleTimeString(),
    }
  ]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [library, setLibrary] = useState<Movie[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAllMovies()
      .then(({ uploaded, synced }) => setLibrary([...uploaded, ...synced]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addMessage = (role: ChatMessage["role"], text: string, type?: ChatMessage["type"]) => {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      text,
      timestamp: new Date().toLocaleTimeString(),
      type,
    };
    setMessages(prev => [...prev, msg]);
    return msg;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    addMessage("user", trimmed);
    setInput("");
    setIsThinking(true);
    setIsProcessing(true);

    try {
      const intent = parseUserIntent(trimmed);
      addMessage("raja", `Samajh gaya! 🧠\n\n• Anime/Movies: ${intent.animeList.join(", ") || "kuch nahi mila, phir se bolo?"}\n• Row: ${intent.rowTitle}\n• Section: ${intent.section}\n• Provider: ${intent.provider} (Nxsha default)`, "thinking");

      if (intent.animeList.length === 0) {
        addMessage("raja", "Bhai anime ka naam to de! Jaise 'Violet Evergarden' ya 'Your Name, Suzume'. Fir se bol.", "error");
        setIsThinking(false);
        setIsProcessing(false);
        return;
      }

      addMessage("raja", `👑 Raja shuru kar raha hai — ${intent.animeList.length} items, row "${intent.rowTitle}" → ${intent.section}...`, "log");

      const movieRefs: string[] = [];
      const movieIds: number[] = [];
      const newMoviesToInsert: Movie[] = [];

      for (let i = 0; i < intent.animeList.length; i++) {
        const name = intent.animeList[i].trim();
        if (!name) continue;

        addMessage("raja", `🔍 Checking library: ${name}`, "log");

        const existing = findMovieByName(name, library);
        if (existing) {
          const ref = getMovieRef(existing);
          movieRefs.push(ref);
          movieIds.push(existing.id);
          addMessage("raja", `✅ Library me mil gaya: ${existing.title} → ${ref}`, "log");
          continue;
        }

        addMessage("raja", `🌐 Library me nahi hai, AniList+Jikan se fetch kar raha hu: ${name}... (IMDb khud nikalunga)`, "log");

        try {
          const params = new URLSearchParams({ title: name });
          const res = await fetch(`/api/anime-auto?${params.toString()}`);
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `API ${res.status}`);
          }
          const data = (await res.json()) as AutoFetchResult & { imdbId?: string; autoResolvedImdb?: string; imdbAutoResolved?: boolean };

          const serverImdb = (data as any).imdbId || (data as any).autoResolvedImdb;
          const imdbToUse = serverImdb;

          if (imdbToUse) {
            if ((data as any).imdbAutoResolved) {
              addMessage("raja", `🎯 Auto-found IMDb for "${name}" → ${imdbToUse}`, "log");
            }
            const movies = autoFetchToMovies(data, {
              imdbId: imdbToUse,
              providerId: intent.provider,
            });
            if (movies.length > 0) {
              newMoviesToInsert.push(...movies);
              const first = movies[0];
              if (first.playlistId) {
                movieRefs.push(`playlist:${first.playlistId}`);
                addMessage("raja", `✨ ${movies.length} episodes banaye ${data.mainTitle} (S${data.totalSeasons}) → ${first.playlistId} [${imdbToUse}]`, "log");
              } else {
                movieRefs.push(getMovieRef(first));
                movieIds.push(first.id);
                addMessage("raja", `✨ Movie banaya: ${first.title} [${imdbToUse}]`, "log");
              }
            }
          } else {
            // No IMDb — still create metadata
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
            addMessage("raja", `✨ Metadata-only banaya: ${single.title} (IMDb nahi mila)`, "log");
          }

          await new Promise(r => setTimeout(r, 600));
        } catch (e: any) {
          addMessage("raja", `❌ Failed ${name}: ${e.message}`, "error");
        }
      }

      // Insert
      let inserted: Movie[] = [];
      if (newMoviesToInsert.length > 0) {
        addMessage("raja", `💾 ${newMoviesToInsert.length} movies DB me daal raha hu...`, "log");
        try {
          inserted = await insertMovies(newMoviesToInsert, "uploaded");
          if (inserted.length === 0) {
            inserted = newMoviesToInsert;
            addMessage("raja", `⚠️ Supabase 0 return, local IDs use kar raha hu`, "log");
          } else {
            addMessage("raja", `✅ ${inserted.length} movies DB me save ho gaye`, "log");
          }
        } catch (e: any) {
          inserted = newMoviesToInsert;
          addMessage("raja", `❌ DB error: ${e.message}, local use kar raha hu`, "error");
        }
      }

      const finalRefs: string[] = [...movieRefs];
      const finalIds: number[] = [...movieIds];
      inserted.forEach(m => {
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

      const uniqueRefs = Array.from(new Set(finalRefs));
      const uniqueIds = Array.from(new Set(finalIds));

      addMessage("raja", `📦 Final row me ${uniqueRefs.length} items honge`, "log");

      const newRow: CustomRow = {
        id: `row_${Date.now()}`,
        title: intent.rowTitle,
        titleSize: "lg",
        visible: true,
        movieIds: uniqueIds,
        movieRefs: uniqueRefs,
        isLarge: false,
        section: intent.section,
      };

      const cfg = loadConfig();
      const nextRows = [...(cfg.customRows || []), newRow];
      const saved = await saveConfig({ ...cfg, customRows: nextRows }, { allowEmptyCustomRows: true });

      if (saved) {
        addMessage("raja", `🎉 Ho gaya bhai! Row "${intent.rowTitle}" section "${intent.section}" me ban gaya with ${uniqueRefs.length} items!\n\nJo anime library me nahi the wo maine khud fetch karke add kar diye — cover, banner, description + Nxsha player ke saath. Page refresh kar ke dekh!`, "success");
        onDone?.();
      } else {
        addMessage("raja", `❌ Row save fail — Supabase RLS check kar`, "error");
      }
    } catch (e: any) {
      addMessage("raja", `💥 Error: ${e.message}`, "error");
    } finally {
      setIsThinking(false);
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-end p-0 md:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full md:w-[420px] h-[85vh] md:h-[600px] bg-[#0f0f0f] border border-amber-500/20 rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-black/20 flex items-center justify-center">
              <Crown size={18} className="text-white" />
            </div>
            <div>
              <h3 className="text-white font-black text-sm flex items-center gap-2">
                Raja AI Agent <Bot size={14} />
              </h3>
              <p className="text-white/70 text-[10px]">Pura dimag hai • Bas naam bolo, upload kar dega</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-black/20 hover:bg-black/30 flex items-center justify-center text-white">
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0a0a0a]">
          {messages.map(m => (
            <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role !== "user" && (
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${m.role === "raja" ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-white/10"}`}>
                  {m.role === "raja" ? <Crown size={12} className="text-white" /> : <Sparkles size={12} className="text-white/60" />}
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                m.role === "user" 
                  ? "bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white rounded-br-sm" 
                  : m.type === "success"
                    ? "bg-green-500/10 border border-green-500/20 text-green-200 rounded-bl-sm"
                    : m.type === "error"
                      ? "bg-red-500/10 border border-red-500/20 text-red-200 rounded-bl-sm"
                      : m.type === "thinking"
                        ? "bg-amber-500/10 border border-amber-500/20 text-amber-200 rounded-bl-sm"
                        : "bg-[#1a1a1a] border border-white/5 text-white/80 rounded-bl-sm"
              }`}>
                {m.text}
                <div className="text-[9px] opacity-50 mt-1">{m.timestamp}</div>
              </div>
              {m.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <User size={12} className="text-white/60" />
                </div>
              )}
            </div>
          ))}
          {isThinking && (
            <div className="flex gap-2 justify-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <Crown size={12} className="text-white" />
              </div>
              <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-amber-400" />
                <span className="text-[11px] text-white/50">Raja soch raha hai...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick suggestions */}
        <div className="px-4 py-2 bg-[#111] border-t border-white/5 flex gap-2 overflow-x-auto">
          {["Violet Evergarden", "Your Name, Suzume", "POPULAR MOVIES me Demon Slayer daal"].map(s => (
            <button
              key={s}
              onClick={() => setInput(s)}
              className="whitespace-nowrap px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-white/60 hover:text-white transition"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="p-3 bg-[#0f0f0f] border-t border-white/10 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Bol bhai, kaunsa anime upload karna hai? (jaise Violet Evergarden)"
            className="flex-1 bg-[#1a1a1a] border border-white/10 rounded-full px-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
            disabled={isProcessing}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="w-10 h-10 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 disabled:opacity-40 flex items-center justify-center text-white transition"
          >
            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>

        <div className="px-4 py-2 bg-[#0a0a0a] border-t border-white/5">
          <p className="text-[9px] text-white/20 text-center flex items-center justify-center gap-1">
            <AlertCircle size={8} /> Raja sirf admin ke liye • Public ko nahi dikhega • Bas naam bolo, IMDb + player khud banega
          </p>
        </div>
      </div>
    </div>
  );
}
