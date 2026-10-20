import { useEffect, useRef, useState } from "react";
import { getMovieboxCrop } from "../lib/moviebox";

/**
 * Sirf-Player frame — bas player + episode grid, upar-neeche sab kata
 * ====================================================================
 * Desktop par iframe ek fixed 1280px wale "stage" par render hota hai
 * aur stage poori screen ke hisaab se scale hoti hai. Stage ke andar
 * iframe itna upar dhakela hota hai ki M2Box ka header/menu hamesha
 * dabbe ke bahar rahe, aur dabbe ki unchai player ke control-bar ke
 * just neeche khatm hoti hai — title/detail wala hissa bilkul nahi
 * dikhta. Desktop par iframe ke andar scroll bhi band hai, taaki
 * scroll karke bhi neeche na pahuncha ja sake (mobile par episode
 * list player ke neeche hoti hai, isliye wahan scroll khula hai).
 *
 * Fullscreen: video fullscreen hote hi crop/scale hatt jata hai,
 * warna kata-scale hua hissa fullscreen me bhi bigda rehta.
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
      // Fullscreen ki halat bhi har nap ke saath sync rakho — event
      // kabhi miss ho jaye to purani halat chipki na reh jaye.
      setIsFullscreen(!!document.fullscreenElement);
    };
    measure();
    window.addEventListener("resize", measure);
    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Fullscreen se wapas aate hi layout ek pal me settle hota hai;
      // nap dobara lo taaki fullscreen wala bada size chipka na reh
      // jaye (usi chipke size se crop ki unchai badh jati thi aur
      // player ke neeche wala title dikhne lagta tha).
      const el = outerRef.current;
      if (!el) return;
      const remeasure = () => {
        const r = el.getBoundingClientRect();
        setSize({ w: r.width, h: r.height });
      };
      requestAnimationFrame(remeasure);
      window.setTimeout(remeasure, 80);
      window.setTimeout(remeasure, 250);
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
      {/* Dikhne wala dabba — iske bahar ka sab kata hua hai. */}
      <div
        className="relative overflow-hidden bg-black shrink-0"
        style={
          isFullscreen
            ? { width: "100%", height: "100%" }
            : { width: crop.frameWidth, height: crop.height }
        }
      >
        {/* Stage: iframe apni fixed chaudai par, screen ke hisaab se scale. */}
        <div
          className="relative"
          style={
            isFullscreen
              ? { width: "100%", height: "100%" }
              : {
                  width: crop.stageWidth,
                  height: crop.stageVisibleHeight,
                  transform: crop.scale !== 1 ? `scale(${crop.scale})` : undefined,
                  transformOrigin: "top left",
                }
          }
        >
          <iframe
            ref={iframeRef}
            src={src}
            title={title || "M2Box player"}
            className="absolute left-0 border-0"
            style={
              isFullscreen
                ? { top: 0, width: "100%", height: "100%" }
                : {
                    top: -crop.cropTop,
                    width: crop.stageWidth,
                    height: crop.stageVisibleHeight + crop.cropTop,
                  }
            }
            // Desktop: andar scroll HAMESHA band (fullscreen me bhi) —
            // warna fullscreen se lautne par page khiska hua mil sakta
            // hai aur neeche wala hissa dikhne lagta hai.
            // Mobile: episode list player ke neeche hai, scroll zaroori hai.
            {...(crop.stacked ? {} : { scrolling: "no" })}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            sandbox={sandbox}
            onLoad={onLoad}
          />
        </div>
      </div>
    </div>
  );
}
