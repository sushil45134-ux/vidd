import { useEffect, useRef, useState } from "react";
import { X, Upload, Link2, RotateCcw } from "lucide-react";
import type { Movie } from "../data";

interface Props {
  movie: Movie;
  onClose: () => void;
  onSave: (newUrl: string) => void | Promise<void>;
}

export default function ThumbnailEditor({ movie, onClose, onSave }: Props) {
  const [preview, setPreview] = useState<string>(movie.image);
  const [url, setUrl] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const blobRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  const setBlob = (file: File) => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    // Convert to a data URL so it survives reload and can be persisted to the DB.
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      blobRef.current = null;
      setPreview(dataUrl);
      setUrl("");
    };
    reader.readAsDataURL(file);
  };

  const applyUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    setPreview(trimmed);
  };

  const resetYouTube = () => {
    if (!movie.youtubeId) return;
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
    const yt = `https://img.youtube.com/vi/${movie.youtubeId}/hqdefault.jpg`;
    setPreview(yt);
    setUrl(yt);
  };

  const handleSave = async () => {
    if (!preview || preview === movie.image) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(preview);
      // do not revoke blob here — parent now owns the preview URL
      blobRef.current = null;
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#0b0b0f] rounded-2xl shadow-2xl ring-1 ring-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h3 className="text-white font-semibold text-sm">Change Thumbnail</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"
          >
            <X size={16} className="text-white" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="aspect-video w-full rounded-md overflow-hidden bg-black/60 ring-1 ring-white/10">
            {preview ? (
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/40 text-xs">
                No preview
              </div>
            )}
          </div>

          <div>
            <label className="block text-white/70 text-xs mb-1.5">Upload image</label>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 border border-white/15 hover:border-white/40 rounded-md py-2.5 text-white/80 text-sm transition-colors"
            >
              <Upload size={14} />
              Choose file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setBlob(f);
              }}
            />
          </div>

          <div>
            <label className="block text-white/70 text-xs mb-1.5">Or paste image URL</label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 bg-black/40 border border-white/10 rounded-md px-2.5">
                <Link2 size={14} className="text-white/40" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 bg-transparent text-white text-sm py-2 outline-none"
                />
              </div>
              <button
                onClick={applyUrl}
                className="px-3 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs"
              >
                Preview
              </button>
            </div>
          </div>

          {movie.youtubeId && (
            <button
              onClick={resetYouTube}
              className="flex items-center gap-2 text-white/60 hover:text-white text-xs"
            >
              <RotateCcw size={12} />
              Reset to YouTube default
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-white/10 bg-black/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-white/70 hover:text-white text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-md bg-[#f47521] hover:bg-[#ff8636] disabled:opacity-60 text-white font-semibold text-sm"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
