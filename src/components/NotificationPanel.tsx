import { useEffect, useRef } from "react";
import type { Movie } from "../data";

interface NotificationPanelProps {
  onClose: () => void;
  onMovieClick: (movie: Movie) => void;
}

export default function NotificationPanel({ onClose }: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

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
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-white font-bold text-sm">Notifications</h3>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        <div className="p-8 text-center">
          <p className="text-gray-400 text-sm">No new notifications</p>
          <p className="text-gray-600 text-xs mt-2">
            You're all caught up!
          </p>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-gray-700 text-center">
        <button
          onClick={onClose}
          className="text-gray-400 text-xs hover:text-white transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
