import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { LogOut, Home, Crown, LayoutGrid, Sparkles } from "lucide-react";
import Logo from "@/components/Logo";
import RajaAgent from "@/components/RajaAgent";
import AdminRowsEditor from "@/components/AdminRowsEditor";
import type { Movie } from "@/data";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "vid Admin" },
      { name: "description", content: "Sign in to manage vid uploads, playlists, and streaming site settings." },
      { property: "og:title", content: "vid Admin" },
      { property: "og:description", content: "Sign in to manage vid uploads, playlists, and streaming site settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setIsAdmin(d.isAdmin === true))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-white/20 border-t-[#ff6a00] rounded-full animate-spin" />
      </div>
    );
  }

  return isAdmin ? <AdminDashboard /> : <AdminLoginPage />;
}

function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password.trim()) {
      setError("Email and password required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        window.location.reload();
      } else {
        setError(data.error || "Invalid credentials");
      }
    } catch {
      setError("Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 text-white">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#ff6a00]/5 rounded-full blur-[150px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#ff6a00] to-[#ee0979] flex items-center justify-center shadow-xl shadow-[#ff6a00]/20">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <h1 className="inline-flex items-end justify-center gap-1 leading-none">
            <Logo text="vid" size="lg" showDot />
            <span className="logo-text logo-text-suffix text-4xl md:text-5xl ml-1">sync</span>
          </h1>
          <p className="text-white/30 text-xs mt-1">Admin Access</p>
        </div>

        <div className="bg-[#111]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
          <h2 className="text-base font-bold mb-5 text-center">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] text-white/40 font-medium block mb-1.5 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#ff6a00]/50 transition"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 font-medium block mb-1.5 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#ff6a00]/50 transition"
              />
            </div>
            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-3 py-2.5 rounded-xl">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-gradient-to-r from-[#ff6a00] to-[#ee0979] hover:opacity-90 text-white rounded-xl text-sm font-bold transition disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

type AdminTab = "overview" | "raja" | "rows";

function AdminDashboard() {
  const [tab, setTab] = useState<AdminTab>("raja");
  const [movies, setMovies] = useState<Movie[]>([]);
  const [showRowsEditor, setShowRowsEditor] = useState(false);

  useEffect(() => {
    // Load movies for Raja
    import("@/lib/moviesRepo")
      .then(({ fetchAllMovies }) => fetchAllMovies())
      .then(({ uploaded, synced }) => {
        const all = [...uploaded, ...synced];
        // Build collections for display
        // For Raja we want flat + collections both
        const byId = new Map<number, Movie>();
        all.forEach((m) => byId.set(m.id, m));
        // Also include collection cards
        const covers: Record<string, string> = {};
        try {
          const raw = localStorage.getItem("vid:collection-covers");
          if (raw) Object.assign(covers, JSON.parse(raw));
        } catch {}
        // Simple dedup for display
        setMovies(all);
      })
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-black/90 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#ff6a00] to-[#ee0979] flex items-center justify-center">
              <Crown size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-black leading-none">
                <span className="bg-gradient-to-r from-[#ff6a00] to-[#ff8533] bg-clip-text text-transparent">Admin</span>
                <span className="text-white"> Panel</span>
              </h1>
              <p className="text-[10px] text-white/30 mt-0.5">Raja AI • Custom Rows • Management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="h-9 px-3 rounded-full bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white/80 hover:text-white text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Home size={13} /> Home
            </a>
            <button
              onClick={handleLogout}
              className="h-9 px-3 rounded-full bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white/80 hover:text-white text-xs font-bold flex items-center gap-1.5 transition"
            >
              <LogOut size={13} /> Logout
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1 bg-[#111] rounded-xl p-1 w-fit">
            <button
              onClick={() => setTab("raja")}
              className={`h-9 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition ${tab === "raja" ? "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow" : "text-white/50 hover:text-white hover:bg-white/5"}`}
            >
              <Crown size={14} /> Raja AI Agent
            </button>
            <button
              onClick={() => setTab("rows")}
              className={`h-9 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition ${tab === "rows" ? "bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white shadow" : "text-white/50 hover:text-white hover:bg-white/5"}`}
            >
              <LayoutGrid size={14} /> Custom Rows
            </button>
            <button
              onClick={() => setTab("overview")}
              className={`h-9 px-4 rounded-lg text-xs font-bold flex items-center gap-2 transition ${tab === "overview" ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/5"}`}
            >
              <Sparkles size={14} /> Overview
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {tab === "overview" && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#ff6a00] to-[#ee0979] flex items-center justify-center shadow-xl shadow-[#ff6a00]/20">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <h2 className="text-2xl font-black mb-2">Welcome, Admin</h2>
              <p className="text-white/40 text-sm mb-8">
                Raja AI Agent se tum movie category me POPULAR MOVIES jaise rows bana sakte ho. Bas list do, jo anime nahi hai wo Raja khud add kar dega!
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setTab("raja")}
                  className="h-11 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 text-white font-bold text-sm flex items-center gap-2 transition"
                >
                  <Crown size={16} /> Open Raja Agent
                </button>
                <button
                  onClick={() => setShowRowsEditor(true)}
                  className="h-11 px-6 rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white font-bold text-sm flex items-center gap-2 transition"
                >
                  <LayoutGrid size={16} /> Custom Rows
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "raja" && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="text-xl font-black flex items-center gap-2">
                <Crown className="text-amber-400" size={20} /> Raja AI Agent
              </h2>
              <p className="text-white/40 text-xs mt-1">
                Movie category me POPULAR MOVIES jaisa row banana hai? Bas niche list daalo jaise Your Name, Suzume — Raja pura website scan karega, jo movies library me hai unko row me laga dega, jo nahi hai unko khud AniList+Jikan se fetch karke add kar dega. Ekdum automatic!
              </p>
            </div>
            <div className="bg-[#111] border border-white/10 rounded-2xl p-5">
              <RajaAgent availableMovies={movies} onDone={() => { /* optional refresh */ }} />
            </div>
          </div>
        )}

        {tab === "rows" && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="text-xl font-black flex items-center gap-2">
                <LayoutGrid className="text-[#ff6a00]" size={20} /> Custom Rows Manager
              </h2>
              <p className="text-white/40 text-xs mt-1">Manually rows banao, edit karo, hide/show karo.</p>
            </div>
            <div className="bg-[#111] border border-white/10 rounded-2xl p-5 text-center">
              <p className="text-white/60 text-sm mb-4">Custom Rows Editor kholne ke liye button dabao — wahan tum movies pick karke rows bana sakte ho.</p>
              <button
                onClick={() => setShowRowsEditor(true)}
                className="h-11 px-6 rounded-xl bg-gradient-to-r from-[#ff6a00] to-[#ee0979] text-white font-bold text-sm"
              >
                Open Custom Rows Editor
              </button>
            </div>
          </div>
        )}
      </main>

      {showRowsEditor && (
        <AdminRowsEditor
          onClose={() => setShowRowsEditor(false)}
          availableMovies={(() => {
            // Build collections for rows editor display
            const covers: Record<string, string> = {};
            try {
              const raw = localStorage.getItem("vid:collection-covers");
              if (raw) Object.assign(covers, JSON.parse(raw));
            } catch {}
            // Use same buildCollections logic as App.tsx for consistency
            const groups = new Map<string, Movie[]>();
            movies.forEach((m) => {
              if (!m.playlistId) return;
              if (!groups.has(m.playlistId)) groups.set(m.playlistId, []);
              groups.get(m.playlistId)!.push(m);
            });
            if (groups.size === 0) return movies;
            const emitted = new Set<string>();
            const out: Movie[] = [];
            movies.forEach((m) => {
              if (!m.playlistId) {
                out.push(m);
                return;
              }
              if (emitted.has(m.playlistId)) return;
              emitted.add(m.playlistId);
              const eps = groups.get(m.playlistId)!;
              const seasonMap = new Map<number, Movie[]>();
              eps.forEach((e) => {
                const s = e.seasonNumber || 1;
                if (!seasonMap.has(s)) seasonMap.set(s, []);
                seasonMap.get(s)!.push(e);
              });
              const seasons = Array.from(seasonMap.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([seasonNumber, seasonEps]) => ({
                  seasonNumber,
                  episodes: [...seasonEps].sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0)),
                }));
              const flatEps = seasons.flatMap((s) => s.episodes);
              const first = flatEps[0];
              let hash = 0;
              for (let i = 0; i < m.playlistId.length; i++) hash = (hash * 31 + m.playlistId.charCodeAt(i)) | 0;
              out.push({
                ...first,
                id: Math.abs(hash) + 1_000_000_000,
                title: first.playlistTitle || first.title,
                description: `${seasons.length > 1 ? `${seasons.length} seasons • ` : ""}${flatEps.length} episodes`,
                isCollection: true,
                episodes: flatEps,
                seasons,
              });
            });
            return out;
          })()}
        />
      )}
    </div>
  );
}
