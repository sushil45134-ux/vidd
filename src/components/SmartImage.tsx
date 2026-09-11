import { useCallback, useEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from "react";
import { FALLBACK_THUMBNAIL } from "../lib/media";
import { shouldGateImageVisibility, watchElementVisibility } from "../lib/lazyViewport";

interface SmartImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> {
  src: string | string[] | undefined;
}

export default function SmartImage({ src, alt, loading, ...props }: SmartImageProps) {
  const sources = useMemo(() => {
    const list = Array.isArray(src) ? src : src ? [src] : [];
    const seen = new Set<string>();
    const cleaned = list
      .map((value) => value.trim())
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    return cleaned.length > 0 ? cleaned : [FALLBACK_THUMBNAIL];
  }, [src]);

  const [sourceIndex, setSourceIndex] = useState(0);

  // Chromium 69 (Samsung Tizen 5.5) ignores loading="lazy" entirely, so on
  // TVs we defer assigning `src` until the element is actually near the
  // viewport. Desktop browsers and SSR never gate (the initialiser runs
  // server-side too) — there, `loading="lazy"` stays a pure hint as before.
  const [inView, setInView] = useState(() => !(loading === "lazy" && shouldGateImageVisibility()));
  const imgRef = useRef<HTMLImageElement | null>(null);
  const markVisible = useCallback(() => setInView(true), []);

  useEffect(() => {
    setSourceIndex(0);
  }, [sources]);

  useEffect(() => {
    if (inView) return;
    const el = imgRef.current;
    if (!el) {
      setInView(true);
      return;
    }
    try {
      return watchElementVisibility(el, markVisible);
    } catch (_) {
      // Never let a broken observer strategy hide a poster forever.
      setInView(true);
    }
    return undefined;
  }, [inView, markVisible]);

  return (
    <img
      {...props}
      ref={imgRef}
      // Gated TV images render without src: the box keeps its layout via the
      // parent media frame, but no network request is made until it is near
      // the viewport.
      src={inView ? sources[sourceIndex] || FALLBACK_THUMBNAIL : undefined}
      loading={loading}
      alt={alt}
      decoding={props.decoding || "async"}
      onError={() => {
        setSourceIndex((current) => {
          const next = current + 1;
          return next < sources.length ? next : current;
        });
      }}
    />
  );
}
