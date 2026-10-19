import { useEffect, useRef, useState } from "react";
import { getMovieboxCrop } from "../lib/moviebox";

/**
 * Sirf-Player frame — M2Box page ka bas wahi hissa jo kaam ka hai
 * ================================================================
 * Poora page ek iframe me hi chalta hai, lekin iframe ek
 * overflow-hidden dabbe ke andar utna upar dhakela hota hai ki M2Box
 * ka logo/search/menu wala upar ka hissa hamesha dabbe ke bahar rahe,
 * aur dabbe ki unchai player (16:9) ke hisaab se itni rakhi jati hai
 * ki neeche wali site-detail bhi na dikhe. Dikhne me bas video player
 * + daayein taraf episode grid (mobile par neeche) reh jata hai —
 * bilkul user ke gore hue hisse jaisa. Nap `getMovieboxCrop` me hai
 * aur dabbe ke size ke saath khud badalta hai (ResizeObserver).
 *
 * Do suraksaa:
 *  - Frame ke andar scroll khula hai: nap kahiin 10-20px idhar-udhar
 *    ho to controls/episodes tak halka scroll karke pahuncha ja sakta
 *    hai; header phir bhi kabhi wapas nahi aata (wo shuru se hi
 *    dabbe ke bahar hai, scroll up ki seema wahi hai).
 *  - Fullscreen: video fullscreen hote hi crop hatt jata hai (warna
 *    kata hua upar ka hissa fullscreen me bhi gayab rehta).
 */

interface MovieboxCroppedFrameProps {
  src: string;
  title?: string;
  sandbox?: string;
  onLoad?: () => void;
}

export default function MovieboxCroppedFrame({
  src,
  title,
  sandbox,
  onLoad,
}: MovieboxCroppedFrameProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(
        !!document.fullscreenElement && document.fullscreenElement === iframeRef.current,
      );
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const crop = getMovieboxCrop(size.w, size.h);

  return (
    <div
      ref={outerRef}
      className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
    >
      <div
        className="relative overflow-hidden bg-black shrink-0"
        style={
          isFullscreen
            ? { width: "100%", height: "100%" }
            : { width: crop.frameWidth, height: crop.height }
        }
      >
        <iframe
          ref={iframeRef}
          src={src}
          title={title || "M2Box player"}
          className="absolute left-0 w-full border-0"
          style={
            isFullscreen
              ? { top: 0, height: "100%" }
              : { top: -crop.cropTop, height: crop.height + crop.cropTop }
          }
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          sandbox={sandbox}
          onLoad={onLoad}
        />
      </div>
    </div>
  );
}
