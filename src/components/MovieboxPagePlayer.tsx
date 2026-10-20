import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, Play, RefreshCw, ShieldAlert, Crop, Frame } from "lucide-react";
import MovieboxCroppedFrame from "./MovieboxCroppedFrame";

/**
 * Full M2Box page player — "poora page website ke andar" mode
 * =============================================================
 * m2box.org ka poora watch page (player + Resources episode grid + site
 * ki search/nav, bilkul screenshot jaisa) ek fullscreen iframe me hamari
 * hi site ke andar khulta hai. Upar koi patti NAHI hai — bas player.
 * Zaroori buttons (band karo, Poora Page, Direct Video…) upar-left ek
 * chhoti si floating pill me rehte hain, halke transparent.
 *
 * Iframe jaan-boojh kar bina `allow-top-navigation` ke chalta hai, taaki
 * M2Box ki site (ya uski ads) hamari tab ko hijack na kar sake; baaki
 * scripts / same-origin / forms / downloads / popups allowed hain taaki
 * poori site — episode chunna, quality, subtitles, download — frame ke
 * andar bilkul waise chale jaise m2box.org par chalti hai.
 */

export const MOVIEBOX_FRAME_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts";

interface MovieboxPagePlayerProps {
  /** M2Box watch page ka poora URL (canonical /movies/…?id=…). */
  pageUrl: string;
  title?: string;
  onClose: () => void;
  /** Frame fail/blank ho? Apne direct-video player (resolver) par jao. */
  onTryDirect?: () => void;
}

type FrameMode = "direct" | "proxy";
type ViewMode = "crop" | "full";

export default function MovieboxPagePlayer({
  pageUrl,
  title,
  onClose,
  onTryDirect,
}: MovieboxPagePlayerProps) {
  const [mode, setMode] = useState<FrameMode>("direct");
  // Default: sirf player + episode wala hissa ("crop"). Chaho to ek tap me
  // poora M2Box page ("full") bhi dikha sakte ho.
  const [view, setView] = useState<ViewMode>("crop");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const helpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const src = mode === "proxy" ? `/api/moviebox-frame?url=${encodeURIComponent(pageUrl)}` : pageUrl;

  // Iframe ka onLoad cross-origin block me bhi fire hota hai, isliye pakka
  // pata kabhi nahi chalta ki page andar sach me khula ya browser ne
  // X-Frame-Options ki wajah se blank error dikhaya. Isliye kuch der baad
  // ek chhoti madad-patti khud dikh jaati hai: "kuch nahi dikh raha?
  // Direct Video dabao." Wahi rasta upar-left wali pill me bhi hai.
  useEffect(() => {
    setLoading(true);
    setShowHelp(false);
    if (helpTimer.current) clearTimeout(helpTimer.current);
    helpTimer.current = setTimeout(() => setShowHelp(true), 6000);
    return () => {
      if (helpTimer.current) clearTimeout(helpTimer.current);
    };
  }, [src, reloadKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black animate-fadeIn flex flex-col">
      {/* Upar koi patti nahi — bas player. Zaroori buttons upar-left ek
          chhoti si floating pill me hain (halke transparent; mouse/tap
          le jaane par saaf). Band karne ka X usi me sabse pehle hai. */}
      <div className="relative flex-1 bg-black min-h-0">
        <div className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-md ring-1 ring-white/15 px-1.5 py-1.5 text-white opacity-40 hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-red-500/70 flex items-center justify-center transition active:scale-95"
            title="Band karo (Esc)"
            aria-label="Close player"
          >
            <X size={15} />
          </button>
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
            <span className="hidden sm:inline">
              {view === "crop" ? "Poora Page" : "Sirf Player"}
            </span>
          </button>
          {onTryDirect && (
            <button
              onClick={onTryDirect}
              className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
              title="Direct Video — bina M2Box page ke, sirf video hamare player me"
              aria-label="Direct Video"
            >
              <Play size={14} />
            </button>
          )}
          <button
            onClick={() => {
              setMode((m) => (m === "direct" ? "proxy" : "direct"));
            }}
            className="w-8 h-8 rounded-full hover:bg-white/15 hidden sm:flex items-center justify-center transition active:scale-95"
            title={
              mode === "direct"
                ? "Page blank hai? Proxy Try Karo (hamare server ke raaste)"
                : "Direct Frame par wapas"
            }
            aria-label="Proxy / Direct frame"
          >
            <ShieldAlert size={14} />
          </button>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
            title="Page dobara load karo"
            aria-label="Reload page"
          >
            <RefreshCw size={14} />
          </button>
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer"
            className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center transition active:scale-95"
            title="M2Box par naye tab me kholo"
            aria-label="Open on M2Box in a new tab"
          >
            <ExternalLink size={14} />
          </a>
        </div>

        {/* Default: sirf player + episode grid (header kata hua). "Poora Page"
            dabane par site jaisi hai waisi poori. */}
        {view === "crop" ? (
          <MovieboxCroppedFrame
            key={`crop-${mode}-${reloadKey}`}
            src={src}
            title={title ? `${title} — M2Box` : "M2Box"}
            sandbox={MOVIEBOX_FRAME_SANDBOX}
            onLoad={() => setLoading(false)}
          />
        ) : (
          <iframe
            key={`full-${mode}-${reloadKey}`}
            src={src}
            className="absolute inset-0 w-full h-full border-0"
            title={title ? `${title} — M2Box` : "M2Box"}
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
            <p className="text-xs text-white/60">M2Box page load ho raha hai…</p>
          </div>
        )}

        {showHelp && onTryDirect && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[94vw] flex items-center gap-2 rounded-full bg-black/85 ring-1 ring-white/15 backdrop-blur px-3 py-2 text-white shadow-2xl animate-fadeIn">
            <span className="text-[11px] text-white/75 whitespace-nowrap overflow-hidden text-ellipsis">
              Page blank dikh raha hai?
            </span>
            <button
              onClick={onTryDirect}
              className="h-6 px-2.5 rounded-full bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-[11px] font-bold flex items-center gap-1 shrink-0 active:scale-95"
            >
              <Play size={11} /> Direct Video Chalao
            </button>
            <button
              onClick={() => setShowHelp(false)}
              className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center shrink-0"
              aria-label="Dismiss help"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
