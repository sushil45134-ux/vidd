import { useState, useEffect, useRef } from "react";
import { Search, Bell, X, Upload, RefreshCw, Sparkles, LogOut, Settings } from "lucide-react";
import type { Category } from "../data";
import { useSiteConfig } from "../lib/customization";
import Logo from "./Logo";


interface NavbarProps {
  onSearch: (query: string) => void;
  searchQuery: string;
  activeCategory: Category;
  onCategoryChange: (category: Category) => void;
  onNotificationClick: () => void;
  showNotifications: boolean;
  onUploadClick: () => void;
  onSyncClick: () => void;
  onAiClick: () => void;
  onCustomizeClick: () => void;
  isAdmin: boolean;
  onLogout: () => void;
}


const tabs: { label: string; category: Category }[] = [
  { label: "Home", category: "home" },
  { label: "Discover", category: "discover" },
  { label: "My List", category: "mylist" },
];

const categories: { label: string; icon: string; category: Category }[] = [
  { label: "Movies", icon: "🎬", category: "movies" },
  { label: "Anime", icon: "⛩️", category: "anime" },
  { label: "Cartoon", icon: "🎨", category: "cartoon" },
  { label: "TV Shows", icon: "📺", category: "tvshows" },
  { label: "New", icon: "✨", category: "new" },
];

export default function Navbar({
  onSearch,
  searchQuery,
  activeCategory,
  onCategoryChange,
  onNotificationClick,
  showNotifications,
  onUploadClick,
  onSyncClick,
  onAiClick,
  onCustomizeClick,
  isAdmin,
  onLogout,
}: NavbarProps) {

  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cfg = useSiteConfig();

  useEffect(() => {
    if (searchOpen && inputRef.current) inputRef.current.focus();
  }, [searchOpen]);

  const isActive = (c: Category) => activeCategory === c && !searchQuery;

  return (
    <nav className="fixed top-0 left-0 right-0 z-[100] bg-black border-b border-white/10 h-16">
      <div className="max-w-[1800px] mx-auto h-16 px-4 md:px-8 flex flex-col">
        {/* Row 1: Logo + Actions */}
        <div className="h-9 flex items-center justify-between gap-3">
          <button
            onClick={() => {
              const w = window as unknown as { __ac?: number; __at?: number };
              const now = Date.now();
              if (!w.__at || now - w.__at > 1500) w.__ac = 0;
              w.__at = now;
              w.__ac = (w.__ac || 0) + 1;
              if (w.__ac >= 5) {
                w.__ac = 0;
                window.location.href = "/admin";
                return;
              }
              onCategoryChange("home"); onSearch("");
            }}
            className="relative shrink-0 inline-flex items-end gap-1 leading-none select-none"
            aria-label={`${cfg.brandPrefix}${cfg.brandSuffix} home`}
          >
            <Logo size="sm" />
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {searchOpen ? (
              <div className="flex items-center bg-black/80 border border-white/20 rounded-full overflow-hidden animate-fade-in">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => onSearch(e.target.value)}
                  className="bg-transparent px-3 h-8 text-sm w-36 md:w-56 text-white placeholder-white/40 focus:outline-none"
                />
                <button
                  onClick={() => { setSearchOpen(false); onSearch(""); }}
                  className="px-2 text-white/60 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-0.5 bg-white/5 hover:bg-white/10 rounded-full p-0.5 ring-1 ring-white/10 transition">
                  <button
                    onClick={() => setSearchOpen(true)}
                    className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition"
                    title="Search"
                  >
                    <Search size={15} />
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        onClick={onAiClick}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-purple-300 hover:text-white hover:bg-purple-600/30 transition"
                        title="AI Assistant"
                      >
                        <Sparkles size={14} />
                      </button>
                      <button
                        onClick={onSyncClick}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition"
                        title="Sync YouTube Playlist"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={onCustomizeClick}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition"
                        title="Customize Rows"
                      >
                        <Settings size={14} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={onNotificationClick}
                    className="relative w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition"
                    title="Notifications"
                  >
                    <Bell size={15} className={showNotifications ? "text-white" : ""} />
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#ff6a00]" />
                  </button>
                </div>

                {isAdmin ? (
                  <>
                    <button
                      onClick={onUploadClick}
                      className="h-8 px-3 md:px-4 ml-1 rounded-full bg-gradient-to-r from-[#ff6a00] to-[#ee0979] hover:opacity-90 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-[#ee0979]/20 transition active:scale-95"
                      title="Upload"
                    >
                      <Upload size={13} />
                      <span className="hidden sm:inline">Upload</span>
                    </button>
                    <button
                      onClick={onLogout}
                      className="h-8 w-8 ml-1 rounded-full bg-white/5 hover:bg-white/10 ring-1 ring-white/10 flex items-center justify-center text-white/70 hover:text-white transition"
                      title="Logout"
                    >
                      <LogOut size={14} />
                    </button>
                  </>
                ) : null}

                <div className="w-8 h-8 ml-1 rounded-full overflow-hidden ring-1 ring-white/15 shrink-0">
                  <div className="w-full h-full bg-gradient-to-br from-[#ff6a00] to-[#ee0979] flex items-center justify-center text-xs font-bold text-white">
                    {isAdmin ? "A" : "U"}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 2: Tabs + Categories */}
        <div className="h-7 flex items-center gap-1 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none" }}>
          {tabs.map(t => (
            <button
              key={t.category}
              onClick={() => { onCategoryChange(t.category); onSearch(""); setMobileOpen(false); }}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                isActive(t.category)
                  ? "bg-white/10 text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="h-4 w-px bg-white/10 mx-1 shrink-0" />
          {categories.map(cat => (
            <button
              key={cat.category}
              onClick={() => { onCategoryChange(cat.category); onSearch(""); setMobileOpen(false); }}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                isActive(cat.category)
                  ? "bg-gradient-to-r from-[#ff6a00]/20 to-[#ee0979]/20 text-[#ff6a00] ring-1 ring-[#ff6a00]/30"
                  : "text-white/50 hover:text-white"
              }`}
            >
              <span className="text-xs">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
