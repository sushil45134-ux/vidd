import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Crop,
  ExternalLink,
  Frame,
  Home,
  MonitorPlay,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { buildMovieboxPageUrl, buildMovieboxResolverUrl, isMovieboxUrl } from "../lib/moviebox";
import { MOVIEBOX_FRAME_SANDBOX } from "../components/MovieboxPagePlayer";
import MovieboxCroppedFrame from "../components/MovieboxCroppedFrame";
import { EmbedPlayer } from "../components/EmbedPlayer";

/**
 * /moviebox — poori M2Box site, Vidd ke andar
 * =============================================
 * m2box.org ka poora page (home/search/categories/watch — player aur
 * episode grid ke saath) ek bade frame me yahin khulta hai, taaki poori
 * MovieBox library bina site chhode browse ho sake.
 *
 *   /moviebox                                  → M2Box home
 *   /moviebox?url=<m2box watch link>           → wahi title ka watch page
 *
 * Upar ki patti se koi bhi m2box link paste karke bhi yahin khola ja
 * sakta hai. Frame kisi din blank aaye to "Proxy" mode (hamare server
 * ke raaste HTML) ya — title page par — "Direct Video" (apna resolver
 * player) ka rasta maujood hai.
 */

export const Route = createFileRoute("/moviebox")({
  head: () => ({
    meta: [
      { title: "M2Box — vid" },
      {
        name: "description",
        content: "Browse and watch the full M2Box library inside vid.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MovieboxBrowsePage,
});

const SAMPLE_LINK =
  "https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail";

function initialTarget(): string {
  if (typeof window === "undefined") return "";
  const raw = new URLSearchParams(window.location.search).get("url") || "";
  if (raw && isMovieboxUrl(raw)) return buildMovieboxPageUrl(raw) || raw;
  // Link nahi diya gaya to M2Box ki poori site NAHI kholni — pehle sirf
  // apna link-paste wala page dikhao; link milte hi seedha player.
  return "";
}

function MovieboxBrowsePage() {
  const [pageUrl, setPageUrl] = useState<string>("");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"direct" | "proxy">("direct");
  // Watch page (koi title) khula ho to sirf player + episode wala hissa
  // ("crop"), home/browse par poora page ("full") taaki search chal sake.
  const [view, setView] = useState<"crop" | "full">("full");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [directPlay, setDirectPlay] = useState(false);
  const [hint, setHint] = useState("");

  // ?url= pehle client par padho (SSR par window nahi hota).
  useEffect(() => {
    setPageUrl(initialTarget());
  }, []);

  useEffect(() => {
    setLoading(true);
    // Title ka watch page => sirf player view; M2Box home => poora page.
    setView(pageUrl.includes("/movies/") ? "crop" : "full");
  }, [pageUrl, mode, reloadKey]);

  const resolverUrl = pageUrl && isMovieboxUrl(pageUrl) ? buildMovieboxResolverUrl(pageUrl) : null;

  function openPasted() {
    const raw = input.trim();
    if (!raw) return;
    if (!isMovieboxUrl(raw)) {
      setHint("Ye M2Box ka link nahi laga — m2box.org wala watch link paste karo.");
      return;
    }
    setHint("");
    setDirectPlay(false);
    setPageUrl(buildMovieboxPageUrl(raw) || raw);
    setInput("");
  }

  if (directPlay && resolverUrl) {
    return <EmbedPlayer src={resolverUrl} kind="video" onClose={() => setDirectPlay(false)} />;
  }

  const frameSrc =
    mode === "proxy" ? `/api/moviebox-frame?url=${encodeURIComponent(pageUrl)}` : pageUrl;

  return (
    <div className="relative h-dvh bg-black text-white flex flex-col overflow-hidden">
      {!pageUrl ? (
        /* Shuruaat: koi site nahi, bas link-paste wala saaf page. Link
           dalte hi seedha sirf-player. */
        <div className="relative flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-4 py-14">
          <a
            href="/"
            className="absolute left-3 top-3 z-30 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/10 hover:bg-white/20 ring-1 ring-white/15 text-xs font-bold backdrop-blur transition active:scale-95"
          >
            <ArrowLeft size={14} /> Home
          </a>
          <div className="w-full max-w-xl text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-[#ff6a00] to-[#ee0979] flex items-center justify-center shadow-2xl shadow-[#ee0979]/25">
              <MonitorPlay size={30} className="text-white" />
            </div>
            <h1 className="mt-5 text-2xl font-extrabold tracking-tight">M2Box link paste karo</h1>
            <p className="mt-2 text-sm text-white/55 leading-relaxed">
              M2Box ka koi bhi movie / series wala link yahan daalo — seedha{" "}
              <span className="text-white font-semibold">sirf player + episode list</span> khulegi.
              Poori website, menu, banner — kuch nahi aayega.
            </p>

            <div className="mt-6 flex items-center bg-white/[0.07] border border-white/20 rounded-full overflow-hidden focus-within:border-[#ff6a00]/70 shadow-xl">
              <Search size={16} className="ml-4 text-white/40 shrink-0" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openPasted();
                }}
                placeholder="https://m2box.org/movies/…?id=…"
                className="bg-transparent flex-1 h-12 px-3 text-sm text-white placeholder-white/35 focus:outline-none"
                autoFocus
              />
              <button
                onClick={openPasted}
                className="h-12 px-6 bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-sm font-bold shrink-0 active:scale-95"
              >
                Kholo
              </button>
            </div>

            {hint ? <p className="mt-3 text-xs text-red-300">{hint}</p> : null}

            <button
              onClick={() => {
                setHint("");
                setDirectPlay(false);
                setPageUrl(buildMovieboxPageUrl(SAMPLE_LINK) || SAMPLE_LINK);
              }}
              className="mt-5 inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-white underline decoration-dotted underline-offset-4"
            >
              <Play size={12} /> Example: My Demon [Hindi] khol kar dekho
            </button>
          </div>
        </div>
      ) : (
        /* Watch page: bas player — upar koi patti nahi. Zaroori buttons
           chhoti si floating pill me hain (upar-left, halki transparent;
           mouse/tap le jaane par saaf). */
        <div className="relative flex-1 min-h-0">
          <div className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-md ring-1 ring-white/15 px-1.5 py-1.5 opacity-40 hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={() => {
                setDirectPlay(false);
                setPageUrl("");
              }}
              className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
              title="Wapas — naya link paste karo"
              aria-label="Wapas, naya link paste karo"
            >
              <ArrowLeft size={15} />
            </button>
            <a
              href="/"
              className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
              title="Site ki home par"
              aria-label="Home"
            >
              <Home size={15} />
            </a>
            <span className="w-px h-5 bg-white/15 mx-0.5" />
            <button
              onClick={() => setView((v) => (v === "crop" ? "full" : "crop"))}
              className="h-8 px-2.5 rounded-full bg-gradient-to-r from-[#f5c518]/25 to-[#ff6a00]/25 ring-1 ring-[#f5c518]/40 text-[#ffe27a] text-[11px] font-bold flex items-center gap-1.5 transition active:scale-95"
              title={
                view === "crop"
                  ? "Sirf player dikh raha hai — poora M2Box page dekhna hai?"
                  : "Poora page dikh raha hai — wapas sirf player par"
              }
            >
              {view === "crop" ? <Frame size={13} /> : <Crop size={13} />}
              {view === "crop" ? "Poora Page" : "Sirf Player"}
            </button>
            {resolverUrl && (
              <button
                onClick={() => setDirectPlay(true)}
                className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
                title="Direct Video — M2Box page ke bina, sirf video apne player me"
                aria-label="Direct Video"
              >
                <Play size={14} />
              </button>
            )}
            <button
              onClick={() => setMode((m) => (m === "direct" ? "proxy" : "direct"))}
              className="w-8 h-8 rounded-full hover:bg-white/15 hidden sm:flex items-center justify-center transition active:scale-95"
              title={
                mode === "direct" ? "Page blank aaye to Proxy Try Karo" : "Direct Frame par wapas"
              }
              aria-label="Proxy / Direct frame"
            >
              <ShieldAlert size={14} />
            </button>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
              title="Reload"
              aria-label="Reload"
            >
              <RefreshCw size={14} />
            </button>
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
              title="M2Box par naye tab me kholo"
              aria-label="M2Box par naye tab me kholo"
            >
              <ExternalLink size={14} />
            </a>
          </div>

          {view === "crop" ? (
            <MovieboxCroppedFrame
              key={`crop-${mode}-${reloadKey}-${pageUrl}`}
              src={frameSrc}
              title="M2Box — sirf player"
              sandbox={MOVIEBOX_FRAME_SANDBOX}
              onLoad={() => setLoading(false)}
            />
          ) : (
            <iframe
              key={`full-${mode}-${reloadKey}-${pageUrl}`}
              src={frameSrc}
              className="absolute inset-0 w-full h-full border-0 bg-black"
              title="M2Box — poori site"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              sandbox={MOVIEBOX_FRAME_SANDBOX}
              onLoad={() => setLoading(false)}
            />
          )}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 pointer-events-none">
              <div className="w-10 h-10 border-4 border-white/20 border-t-[#ff6a00] rounded-full animate-spin" />
              <p className="text-xs text-white/60">M2Box load ho raha hai…</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
