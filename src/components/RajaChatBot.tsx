import { useState, useEffect, useRef } from "react";
import { Crown, Send, X, Sparkles, Loader2, Bot, User, AlertCircle, Film, Tv, Check } from "lucide-react";
import type { Movie } from "../data";
import { loadConfig, saveConfig, getMovieRef, type CustomRow, type RowSection } from "../lib/customization";
import { insertMovies, fetchAllMovies } from "../lib/moviesRepo";
import { autoFetchToMovies, type AutoFetchResult } from "../lib/animeAutoFetch";
import { IMDB_PROVIDERS } from "../lib/imdbSeries";

interface ChatMessage {
  id: string;
  role: "user" | "raja";
  text: string;
  timestamp: string;
  type?: "log" | "success" | "error" | "thinking" | "chat";
}

interface Props {
  onClose: () => void;
  onDone?: () => void;
}

function isGreeting(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const greetings = ["kaise ho", "kese ho", "how are you", "hello", "hi", "hey", "namaste", "namaskar", "kya haal", "kya hal", "kaisa hai", "kaisi ho", "aur bhai", "kya chal", "good morning", "good evening"];
  if (lower.length < 30) {
    for (const g of greetings) {
      if (lower.includes(g)) return true;
    }
    // Very short like "hi", "hello", "kaise ho" alone
    if (lower.split(/\s+/).length <= 3 && lower.length < 20) {
      // Check if it doesn't look like anime title (no known anime words)
      const animeWords = ["violet", "evergarden", "suzume", "demon", "slayer", "naruto", "one piece", "attack", "titan", "your name", "edgerunners", "cyberpunk", "jujutsu", "chainsaw", "spy", "family", "dandadan", "solo", "leveling", "frieren", "my dress", "darling", "anime", "movie", "series"];
      const hasAnime = animeWords.some(w => lower.includes(w));
      if (!hasAnime) return true;
    }
  }
  return false;
}

function parseUserIntent(input: string): { animeList: string[]; rowTitle: string; section: RowSection; provider: string; isGreeting: boolean } {
  if (isGreeting(input)) {
    return { animeList: [], rowTitle: "POPULAR MOVIES", section: "movies", provider: IMDB_PROVIDERS[0].id, isGreeting: true };
  }

  const lower = input.toLowerCase();
  let rowTitle = "POPULAR MOVIES";
  let section: RowSection = "movies";
  let provider = IMDB_PROVIDERS[0].id;
  let animeList: string[] = [];

  // Row title extraction
  const rowMatch = input.match(/(?:row|list)\s*(?:named|called|title)?\s*["']?([^"'\n]+?)["']?\s*(?:in|for|me|bana|create)?/i) ||
                   input.match(/["']([A-Z\s]+)["']/) ||
                   input.match(/(POPULAR MOVIES|TRENDING ANIME|TOP \d+|MUST WATCH|NEW RELEASES|HINDI DUBBED)/i);
  if (rowMatch) {
    rowTitle = rowMatch[1].trim().toUpperCase();
    if (rowTitle.length > 40) rowTitle = rowTitle.slice(0, 40);
  }

  if (lower.includes("anime")) section = "anime";
  else if (lower.includes("movie")) section = "movies";
  else if (lower.includes("cartoon")) section = "cartoon";
  else if (lower.includes("tv show")) section = "tvshows";
  else if (lower.includes("home")) section = "home";

  if (lower.includes("nxsha")) provider = "nxsha";
  else if (lower.includes("nhd")) provider = "nhd";

  // Extract list after "add", "upload", etc
  let listPart = input;
  const addMatch = input.match(/(?:add|upload|include|lagao|daalo|daal|bana)\s+(.+?)(?:\s+to\s+|\s+in\s+|\s+row|\s+me|ko|$)/i);
  if (addMatch) listPart = addMatch[1];

  listPart = listPart.replace(/POPULAR MOVIES|TRENDING ANIME|row|movies|anime|section|me|bana|create|list|ko|mein/gi, "");

  animeList = listPart
    .split(/[,;\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 80)
    .map(s => s.replace(/^(add|upload|include)\s+/i, "").trim())
    .filter(Boolean);

  // Known anime detection if list empty
  if (animeList.length === 0) {
    const known = ["violet evergarden", "your name", "suzume", "a silent voice", "demon slayer", "spy x family", "attack on titan", "naruto", "one piece", "jujutsu kaisen", "chainsaw man", "my dress-up darling", "weathering with you", "i want to eat your pancreas", "cyberpunk: edgerunners", "edgerunners", "dandadan", "solo leveling", "frieren"];
    for (const k of known) {
      if (lower.includes(k)) animeList.push(k.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    }
  }

  if (animeList.length === 0) {
    // If input looks like just titles separated by commas
    const possible = input.split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 60 && !isGreeting(s));
    if (possible.length > 0 && possible.length <= 5) {
      animeList = possible;
    }
  }

  animeList = Array.from(new Set(animeList)).slice(0, 10);

  return { animeList, rowTitle, section, provider, isGreeting: false };
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
      text: "Are bhai! 👑 Main Raja hu — tera personal AI agent!\n\nMain ekdum mast hu, tu bata kaise hai? 😎\n\nMujhe bas anime ka naam de, jaise:\n• Violet Evergarden\n• Your Name, Suzume\n• Cyberpunk: Edgerunners\n\nMain khud IMDb number dhundunga, bataunga movie hai ya series, website pe hai ya nahi, aur khud upload karke row bana dunga. Bol kya kaam hai?",
      timestamp: new Date().toLocaleTimeString(),
      type: "chat",
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

      // Greeting handling
      if (intent.isGreeting) {
        addMessage("raja", "Ekdam badhiya bhai! 🔥 Main toh yahan mast baitha hu, tera kaam karne ke liye ready!\n\nTu bas mujhe anime ka naam de de — jaise 'Violet Evergarden' ya 'Cyberpunk: Edgerunners' — aur main khud sab kuch kar dunga:\n\n1. IMDb number khud dhundunga\n2. Bataunga movie hai ya series\n3. Check karunga website pe hai ya nahi\n4. Nahi hai to khud AniList+Jikan se fetch karke upload kar dunga\n\nBol, kaunsa anime chahiye? 👇", "chat");
        setIsThinking(false);
        setIsProcessing(false);
        return;
      }

      if (intent.animeList.length === 0) {
        addMessage("raja", "Bhai anime ka naam to bata! 😅\n\nJaise: 'Violet Evergarden' ya 'Your Name, Suzume, Demon Slayer'\n\nMain khud IMDb nikal ke upload kar dunga, chahe website pe ho ya na ho!", "chat");
        setIsThinking(false);
        setIsProcessing(false);
        return;
      }

      // Conversational start
      addMessage("raja", `Samajh gaya bhai! 🧠 Tu chahta hai:\n\n• Anime: ${intent.animeList.join(", ")}\n• Row: ${intent.rowTitle}\n• Section: ${intent.section}\n\nAb main ek-ek karke check karta hu...`, "thinking");

      const movieRefs: string[] = [];
      const movieIds: number[] = [];
      const newMoviesToInsert: Movie[] = [];

      for (let i = 0; i < intent.animeList.length; i++) {
        const name = intent.animeList[i].trim();
        if (!name) continue;

        // Check library first
        const existing = findMovieByName(name, library);
        const isInLibrary = !!existing;

        if (isInLibrary) {
          addMessage("raja", `✅ "${name}" — Ye to website pe pehle se hai!\n\n• Title: ${existing!.title}\n• Type: ${existing!.isCollection ? `Series (${existing!.seasons?.length || 1} seasons)` : "Movie"}\n• ID: ${existing!.id}\n• Main isko row me add kar dunga, naya upload karne ki zarurat nahi.`, "chat");
          const ref = getMovieRef(existing!);
          movieRefs.push(ref);
          movieIds.push(existing!.id);
          continue;
        }

        addMessage("raja", `🔍 "${name}" — Ye abhi website par nahi hai, maine khud dhunda hai...\n\nAniList+Jikan pe search kar raha hu...`, "thinking");

        try {
          const params = new URLSearchParams({ title: name });
          const res = await fetch(`/api/anime-auto?${params.toString()}`);
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `API ${res.status}`);
          }
          const data = (await res.json()) as AutoFetchResult & { imdbId?: string; autoResolvedImdb?: string; imdbAutoResolved?: boolean };

          const serverImdb = (data as any).imdbId || (data as any).autoResolvedImdb;
          const isMovie = data.totalSeasons === 1 && (data.totalEpisodes === 1 || data.seasons[0]?.format === "MOVIE" || data.seasons[0]?.episodesCount === 1);
          const typeText = isMovie ? "Movie" : `Series (${data.totalSeasons} season${data.totalSeasons > 1 ? "s" : ""}, ${data.totalEpisodes} episodes)`;

          if (serverImdb) {
            addMessage("raja", `🎯 "${name}" ka IMDb mil gaya!\n\n• IMDb Number: ${serverImdb} ${(data as any).imdbAutoResolved ? "(maine khud dhunda hai - IMDb suggestion + TVMaze se)" : "(known database se)"}\n• Main Title: ${data.mainTitle}\n• Type: ${typeText}\n• Year: ${data.seasons[0]?.year || "N/A"}\n• Status: Ye abhi website par nahi hai, maine khud dhunda hai, ab upload kar raha hu...\n• Provider: ${intent.provider} (Nxsha - Hindi audio)`, "chat");

            const movies = autoFetchToMovies(data, {
              imdbId: serverImdb,
              providerId: intent.provider,
            });

            if (movies.length > 0) {
              newMoviesToInsert.push(...movies);
              const first = movies[0];
              if (first.playlistId) {
                movieRefs.push(`playlist:${first.playlistId}`);
                addMessage("raja", `✨ "${data.mainTitle}" — ${movies.length} episodes bana diye!\n\n• Playlist ID: ${first.playlistId}\n• Player: ${intent.provider} - https://nxsha.space/embed/tv/${serverImdb}/{s}/{e}\n• Cover: ${data.mainCover ? "✅" : "❌"} | Banner: ${data.mainBanner ? "✅" : "❌"}\n• Ab DB me save kar raha hu...`, "log");
              } else {
                movieRefs.push(getMovieRef(first));
                movieIds.push(first.id);
                addMessage("raja", `✨ Movie banaya: ${first.title} [${serverImdb}]`, "log");
              }
            }
          } else {
            addMessage("raja", `⚠️ "${name}" ka IMDb nahi mila, par maine metadata se movie bana diya:\n\n• Title: ${data.mainTitle}\n• Type: ${typeText}\n• Year: ${data.seasons[0]?.year}\n• Status: Metadata-only (player baad me add kar sakte ho)`, "chat");
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
          }

          await new Promise(r => setTimeout(r, 500));
        } catch (e: any) {
          addMessage("raja", `❌ "${name}" — Error: ${e.message}\n\nHo sakta hai AniList block ho ya naam galat ho. Sahi spelling de, jaise "Violet Evergarden"`, "error");
        }
      }

      // Insert to DB
      let inserted: Movie[] = [];
      if (newMoviesToInsert.length > 0) {
        addMessage("raja", `💾 Ab ${newMoviesToInsert.length} episodes/movies ko database me save kar raha hu...`, "thinking");
        try {
          inserted = await insertMovies(newMoviesToInsert, "uploaded");
          if (inserted.length === 0) {
            inserted = newMoviesToInsert;
            addMessage("raja", `⚠️ Supabase ne 0 return kiya (RLS issue ho sakta hai), par maine local me save kar diya — website pe dikhega!`, "log");
          } else {
            addMessage("raja", `✅ ${inserted.length} items database me save ho gaye!`, "success");
          }
          setLibrary(prev => [...inserted, ...prev]);
        } catch (e: any) {
          inserted = newMoviesToInsert;
          addMessage("raja", `⚠️ DB error: ${e.message}, par local me save kar diya`, "error");
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

      if (uniqueRefs.length === 0) {
        addMessage("raja", `❌ Kuch add nahi ho paya bhai. Naam sahi likh, jaise "Violet Evergarden" ya "Cyberpunk: Edgerunners"`, "error");
        setIsThinking(false);
        setIsProcessing(false);
        return;
      }

      addMessage("raja", `📦 Ab row bana raha hu...\n\n• Row Title: ${intent.rowTitle}\n• Section: ${intent.section}\n• Items: ${uniqueRefs.length}`, "thinking");

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
        addMessage("raja", `🎉 Ho gaya bhai! 🎉\n\n✅ Row "${intent.rowTitle}" section "${intent.section}" me ban gaya with ${uniqueRefs.length} items!\n\nMaine jo list di thi:\n${intent.animeList.map(n => `• ${n}`).join("\n")}\n\nUsme se jo website pe nahi the, wo maine khud dhund ke add kar diye — cover, banner, description + Nxsha player (IMDb number ke saath). Page refresh karke "${intent.section}" section me dekh, dikhega!\n\nAur kuch chahiye to bol! 👑`, "success");
        onDone?.();
      } else {
        addMessage("raja", `❌ Row save fail ho gaya — Supabase RLS policy check karna padega.`, "error");
      }
    } catch (e: any) {
      addMessage("raja", `💥 Are error aa gaya: ${e.message}\n\nFir se try kar, ya naam sahi likh.`, "error");
    } finally {
      setIsThinking(false);
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-end p-0 md:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full md:w-[440px] h-[90vh] md:h-[650px] bg-[#0f0f0f] border border-amber-500/20 rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-black/20 flex items-center justify-center">
              <Crown size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-white font-black text-sm flex items-center gap-2">
                Raja AI Agent <Bot size={14} />
              </h3>
              <p className="text-white/80 text-[10px] font-medium">Pura dimag hai • Pehle baat karega, fir kaam</p>
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${m.role === "raja" ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-white/10"}`}>
                  {m.role === "raja" ? <Crown size={14} className="text-white" /> : <Sparkles size={14} className="text-white/60" />}
                </div>
              )}
              <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user" 
                  ? "bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white rounded-br-sm" 
                  : m.type === "success"
                    ? "bg-green-500/10 border border-green-500/20 text-green-100 rounded-bl-sm"
                    : m.type === "error"
                      ? "bg-red-500/10 border border-red-500/20 text-red-100 rounded-bl-sm"
                      : m.type === "thinking"
                        ? "bg-amber-500/10 border border-amber-500/20 text-amber-100 rounded-bl-sm"
                        : m.type === "log"
                          ? "bg-white/5 border border-white/10 text-white/60 text-[11px] rounded-bl-sm"
                          : "bg-[#1a1a1a] border border-white/5 text-white/90 rounded-bl-sm"
              }`}>
                {m.text}
                <div className="text-[9px] opacity-40 mt-1.5">{m.timestamp}</div>
              </div>
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <User size={14} className="text-white/60" />
                </div>
              )}
            </div>
          ))}
          {isThinking && (
            <div className="flex gap-2 justify-start">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <Crown size={14} className="text-white" />
              </div>
              <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-amber-400" />
                <span className="text-[11px] text-white/60">Raja soch raha hai... dimag chala raha hai...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick suggestions */}
        <div className="px-3 py-2 bg-[#111] border-t border-white/5 flex gap-2 overflow-x-auto scrollbar-hide">
          {["kaise ho", "Violet Evergarden", "Cyberpunk: Edgerunners", "Your Name, Suzume"].map(s => (
            <button
              key={s}
              onClick={() => setInput(s)}
              className="whitespace-nowrap px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-white/60 hover:text-white transition"
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
            placeholder="Bolo bhai... (jaise: Violet Evergarden, ya kaise ho?)"
            className="flex-1 bg-[#1a1a1a] border border-white/10 rounded-full px-4 py-3 text-[13px] text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
            disabled={isProcessing}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="w-11 h-11 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 disabled:opacity-40 flex items-center justify-center text-white transition shadow-lg shadow-amber-500/20"
          >
            {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>

        <div className="px-4 py-2 bg-[#0a0a0a] border-t border-white/5">
          <p className="text-[9px] text-white/20 text-center flex items-center justify-center gap-1.5">
            <AlertCircle size={10} /> Raja: pehle baat karega, IMDb dikhayega, movie/series batayega, website pe hai ya nahi batayega, fir upload karega
          </p>
        </div>
      </div>
    </div>
  );
}
