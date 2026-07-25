import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
import { FALLBACK_THUMBNAIL } from "../lib/media";

interface SmartImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> {
  src: string | string[] | undefined;
}

export default function SmartImage({ src, alt, ...props }: SmartImageProps) {
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

  useEffect(() => {
    setSourceIndex(0);
  }, [sources]);

  return (
    <img
      {...props}
      src={sources[sourceIndex] || FALLBACK_THUMBNAIL}
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