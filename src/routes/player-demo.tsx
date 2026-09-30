import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play } from "lucide-react";
import { ViddPlayer } from "@/components/ViddPlayer";
import { isDirectMediaUrl, isHlsUrl } from "@/lib/mediaSource";

export const Route = createFileRoute("/player-demo")({
  head: () => ({
    meta: [
      { title: "vid Player Demo" },
      {
        name: "description",
        content: "Try Vidd's own video player with any direct MP4 or HLS stream.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlayerDemoPage,
});

/**
 * A place to actually SEE Vidd's own player, without needing a title in
 * the catalogue first. Paste any .mp4 or .m3u8 URL and press play — the
 * player opens fullscreen on its own, exactly as it does in the app.
 */

const SAMPLES = [
  {
    label: "HLS · multi-quality (Mux test stream)",
    hint: "Best demo — the Quality menu fills up with real levels",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  },
  {
    label: "HLS · with subtitles + audio tracks",
    hint: "Shows the Subtitles and Audio menus",
    url: "https://playertest.longtailvideo.com/adaptive/elephants_dream_v4/redundant.m3u8",
  },
  {
    label: "MP4 · progressive file",
    hint: "What an uploaded file looks like",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  },
];

function PlayerDemoPage() {
  const [url, setUrl] = useState(SAMPLES[0].url);
  const [playing, setPlaying] = useState<string | null>(null);

  const valid = isDirectMediaUrl(url);

  return (
    <div className="min-h-screen bg-black px-5 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Vidd Player</h1>
        <p className="mt-2 text-sm text-white/60">
          Vidd ka apna player — koi iframe nahi. Isliye khulte hi poori screen, apne aap, bina ek
          bhi click ke. Neeche koi bhi direct <code>.mp4</code> ya <code>.m3u8</code> link daal ke
          dekh lijiye.
        </p>

        <div className="mt-6 space-y-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.url}
              onClick={() => setUrl(sample.url)}
              className={`block w-full rounded-xl border px-4 py-3 text-left transition ${
                url === sample.url
                  ? "border-[#E50914] bg-[#E50914]/10"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <span className="block text-sm font-semibold">{sample.label}</span>
              <span className="block text-xs text-white/50">{sample.hint}</span>
            </button>
          ))}
        </div>

        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-white/50">
          Stream URL
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          placeholder="https://…/master.m3u8"
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none focus:border-[#E50914]"
        />

        <p className="mt-2 text-xs text-white/50">
          {url.trim() === ""
            ? "Ek link daaliye."
            : valid
              ? `Vidd khud chala sakta hai — ${isHlsUrl(url) ? "HLS stream" : "direct file"}.`
              : "Ye ek embed page lagta hai, direct media nahi. Vidd ka player sirf .mp4 / .webm / .m3u8 jaise seedhe links chala sakta hai."}
        </p>

        <button
          disabled={!valid}
          onClick={() => setPlaying(url.trim())}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#E50914] px-6 py-3 text-sm font-bold transition hover:bg-[#f6121d] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>

        <div className="mt-10 rounded-xl border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/60">
          <p className="mb-2 font-semibold text-white/80">Shortcuts</p>
          <p>
            Space / K — play-pause · ← → — 10s · ↑ ↓ — volume · F — fullscreen · M — mute · Esc —
            exit
          </p>
        </div>
      </div>

      {playing && (
        <ViddPlayer
          src={playing}
          title="Vidd Player demo"
          subtitle={isHlsUrl(playing) ? "HLS stream" : "Direct file"}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}
