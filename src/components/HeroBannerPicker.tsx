import { useRef, useState } from "react";
import { X, Upload, Sparkles, Image as ImageIcon, Trash2 } from "lucide-react";
import type { Movie } from "../data";
import {
  loadHeroBanners,
  upsertHeroBanner,
  removeHeroBanner,
} from "../lib/heroBanners";

interface Props {
  movie: Movie;
  onClose: () => void;
}

export default function HeroBannerPicker({ movie, onClose }: Props) {
  const existing = loadHeroBanners().find((b) => b.movieId === movie.id);
  const defaultImg =
    existing?.bannerImage || movie.backdrop || movie.image || "";
  const [bannerImage, setBannerImage] = useState<string>(defaultImg);
  const [title, setTitle] = useState(existing?.title || movie.title);
  const [description, setDescription] = useState(
    existing?.description || movie.description || ""
  );
  const [badge, setBadge] = useState(existing?.badge || "⭐ FEATURED");
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (f: File) => {
    if (f.size > 5 * 1024 * 1024) {
      alert("Please pick an image smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBannerImage(String(reader.result));
    reader.readAsDataURL(f);
  };

  const save = () => {
    if (!bannerImage.trim()) {
      alert("Please add a banner image first.");
      return;
    }
    try {
      upsertHeroBanner({
        movieId: movie.id,
        bannerImage: bannerImage.trim(),
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        badge: badge.trim() || undefined,
      });
      onClose();
    } catch {
      // saveHeroBanners already alerted
    }
  };

  const remove = () => {
    if (!existing) return onClose();
    if (window.confirm("Remove this from the hero banner?")) {
      removeHeroBanner(movie.id);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-[#0b0b0f] rounded-2xl ring-1 ring-white/10 overflow-hidden shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[#ff6a00]" />
            <h3 className="text-white font-bold text-lg">
              Set as Hero Banner
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
          >
            <X size={16} className="text-white" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Live preview */}
          <div className="relative aspect-[21/9] rounded-xl overflow-hidden ring-1 ring-white/10 bg-black">
            {bannerImage ? (
              <img
                src={bannerImage}
                alt="preview"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/40">
                <ImageIcon size={40} />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/40 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 p-5 max-w-xl">
              {badge && (
                <span className="inline-block px-2 py-0.5 bg-[#ff6a00] text-black text-[10px] font-black rounded tracking-wider mb-2">
                  {badge}
                </span>
              )}
              <h4 className="text-white text-2xl md:text-3xl font-black leading-tight mb-1">
                {title || movie.title}
              </h4>
              <p className="text-white/70 text-xs md:text-sm line-clamp-2">
                {description || movie.description}
              </p>
            </div>
          </div>

          {/* Image sources */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 justify-center h-11 rounded-lg bg-white/10 hover:bg-white/15 ring-1 ring-white/10 text-white text-sm font-semibold"
            >
              <Upload size={15} />
              Upload custom banner image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="…or paste image URL"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="flex-1 h-11 px-3 rounded-lg bg-white/5 ring-1 ring-white/10 focus:ring-[#ff6a00]/60 focus:outline-none text-white text-sm placeholder-white/30"
              />
              <button
                onClick={() => {
                  if (urlInput.trim()) {
                    setBannerImage(urlInput.trim());
                    setUrlInput("");
                  }
                }}
                className="h-11 px-4 rounded-lg bg-[#ff6a00] hover:bg-[#ff8533] text-black text-sm font-bold"
              >
                Use
              </button>
            </div>
          </div>

          {/* Text overrides */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1">
                Badge
              </label>
              <input
                type="text"
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                maxLength={24}
                className="w-full h-10 px-3 rounded-lg bg-white/5 ring-1 ring-white/10 focus:ring-[#ff6a00]/60 focus:outline-none text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white/5 ring-1 ring-white/10 focus:ring-[#ff6a00]/60 focus:outline-none text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-white/60 text-xs font-semibold mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-white/5 ring-1 ring-white/10 focus:ring-[#ff6a00]/60 focus:outline-none text-white text-sm resize-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/10 bg-black/40">
          {existing ? (
            <button
              onClick={remove}
              className="flex items-center gap-1.5 h-10 px-4 rounded-full border border-red-500/60 bg-red-600/20 hover:bg-red-600 text-white text-sm font-semibold"
            >
              <Trash2 size={14} />
              Remove from hero
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-10 px-4 rounded-full bg-white/10 hover:bg-white/15 text-white text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="h-10 px-5 rounded-full bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white text-sm font-bold shadow-lg shadow-[#ee0979]/20"
            >
              {existing ? "Update banner" : "Set as hero"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
