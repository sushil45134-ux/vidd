import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { LogOut, Home } from "lucide-react";
import Logo from "@/components/Logo";

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

function AdminDashboard() {
  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-black/90 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black">
              <span className="bg-gradient-to-r from-[#ff6a00] to-[#ff8533] bg-clip-text text-transparent">Admin</span>
              <span className="text-white"> Panel</span>
            </h1>
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
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#ff6a00] to-[#ee0979] flex items-center justify-center shadow-xl shadow-[#ff6a00]/20">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <h2 className="text-2xl font-black mb-2">Welcome, Admin</h2>
          <p className="text-white/40 text-sm mb-8">
            You are signed in as the administrator. Site customization has been disabled.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/"
              className="h-11 px-6 rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white font-bold text-sm flex items-center gap-2 transition"
            >
              <Home size={16} /> Go to Home
            </a>
            <button
              onClick={handleLogout}
              className="h-11 px-6 rounded-xl bg-gradient-to-r from-[#ff6a00] to-[#ee0979] hover:opacity-90 text-white font-bold text-sm flex items-center gap-2 transition"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
