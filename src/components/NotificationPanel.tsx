import { useEffect, useRef } from "react";
import { Film, Tv, Clapperboard } from "lucide-react";
import type { Movie } from "../data";
import { registerTvBackHandler } from "../lib/spatialNav";
import { timeAgo, type AppNotification } from "../lib/notifications";

interface NotificationPanelProps {
  onClose: () => void;
  onMovieClick: (movie: Movie) => void;
  notifications?: AppNotification[];
  /** Notification se seedha us title/collection par jao. */
  onOpenNotification?: (n: AppNotification) => void;
}

const TYPE_ICON = {
  "new-series": Clapperboard,
  "new-episode": Tv,
  "new-video": Film,
} as const;

export default function NotificationPanel({
  onClose,
  notifications = [],
  onOpenNotification,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // TV remote BACK closes the panel.
  useEffect(() => registerTvBackHandler(onClose), [onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="fixed top-16 right-4 md:right-12 w-80 md:w-96 bg-[#1a1a1a] border border-gray-700 rounded shadow-2xl z-[60] overflow-hidden animate-fade-in"
    >
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-white font-bold text-sm">Notifications</h3>
        {notifications.length > 0 && (
          <span className="text-[10px] text-gray-500">{notifications.length}</span>
        )}
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-400 text-sm">No new notifications</p>
            <p className="text-gray-600 text-xs mt-2">
              Naya anime ya episode aate hi yahan message aayega!
            </p>
          </div>
        ) : (
          notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] || Film;
            return (
              <button
                key={n.id}
                onClick={() => onOpenNotification?.(n)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-white/5 transition-colors hover:bg-white/5 ${
                  n.read ? "" : "bg-[#ff6a00]/5"
                }`}
              >
                {n.image ? (
                  <img
                    src={n.image}
                    alt=""
                    loading="lazy"
                    className="w-16 h-10 object-cover rounded flex-shrink-0 bg-black"
                  />
                ) : (
                  <span className="w-16 h-10 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
                    <Icon size={16} className="text-gray-500" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {!n.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ff6a00] flex-shrink-0" />
                    )}
                    <span className="text-white text-xs font-bold truncate">{n.title}</span>
                  </span>
                  <span className="block text-gray-400 text-[11px] mt-0.5 leading-snug">
                    {n.message}
                  </span>
                  <span className="block text-gray-600 text-[10px] mt-0.5">{timeAgo(n.at)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="px-4 py-3 border-t border-gray-700 text-center">
        <button
          onClick={onClose}
          className="text-gray-400 text-xs hover:text-white transition-colors px-3 py-1.5 rounded-full ring-1 ring-white/10"
        >
          Close
        </button>
      </div>
    </div>
  );
}
