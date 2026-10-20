import { useEffect, useState } from "react";
import { X } from "lucide-react";
import MovieboxCroppedFrame from "./MovieboxCroppedFrame";

/**
 * M2Box player — bas player, aur kuch nahi
 * ========================================
 * m2box.org ka watch page ek fullscreen iframe me hamari hi site ke
 * andar khulta hai, lekin `MovieboxCroppedFrame` use is tarah kaat
 * kar dikhata hai ki screen par BAS video player + episode grid
 * bachta hai — site ka header, sidebar, menu, title sab kata hua.
 *
 * Player ke upar apna koi UI nahi hai — na patti, na buttonon ki
 * pill. Sirf band karne ke liye upar-left ek chhota sa gola X hai
 * (bina uske player band hi nahi hoga, khaaskar mobile par jahan
 * Esc nahi hota). Desktop par Esc se bhi band hota hai.
 *
 * Iframe jaan-boojh kar bina `allow-top-navigation` ke chalta hai,
 * taaki M2Box ki site (ya uski ads) hamari tab ko hijack na kar
 * sake; baaki scripts / same-origin / forms / downloads / popups
 * allowed hain taaki episode chunna, quality, subtitles sab frame
 * ke andar waise hi chale jaise m2box.org par chalta hai.
 */

export const MOVIEBOX_FRAME_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts";

interface MovieboxPagePlayerProps {
  /** M2Box watch page ka poora URL (canonical /movies/…?id=…). */
  pageUrl: string;
  title?: string;
  onClose: () => void;
  /**
   * Pehle yahan se "Direct Video" (resolver) par switch hota tha;
   * owner ko player ke upar koi button hi nahi chahiye, isliye ab
   * ye kahin dikhta nahi. Prop isliye rakha hai taaki PlayerOverlay
   * bina badle chalta rahe.
   */
  onTryDirect?: () => void;
}

export default function MovieboxPagePlayer({ pageUrl, title, onClose }: MovieboxPagePlayerProps) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
  }, [pageUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black animate-fadeIn">
      <div className="relative w-full h-full bg-black">
        <MovieboxCroppedFrame
          key={pageUrl}
          src={pageUrl}
          title={title ? `${title} — M2Box` : "M2Box"}
          sandbox={MOVIEBOX_FRAME_SANDBOX}
          onLoad={() => setLoading(false)}
        />

        {/* Band karne ka akela chhota sa gola X — bas yahi ek apna UI hai. */}
        <button
          onClick={onClose}
          className="absolute left-3 top-3 z-30 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md ring-1 ring-white/15 text-white flex items-center justify-center opacity-50 hover:opacity-100 hover:bg-red-500/70 transition active:scale-95"
          title="Band karo (Esc)"
          aria-label="Close player"
        >
          <X size={16} />
        </button>

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 pointer-events-none">
            <div className="w-10 h-10 border-4 border-white/20 border-t-[#ff6a00] rounded-full animate-spin" />
            <p className="text-xs text-white/60">M2Box page load ho raha hai…</p>
          </div>
        )}
      </div>
    </div>
  );
}
