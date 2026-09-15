import { useEffect, useRef, useState } from "react";
import { RefreshCw, Download, CheckCircle2, Sparkles, AlertTriangle } from "lucide-react";
import {
  fetchEpisodeSyncPlan,
  dedupeSyncRows,
  syncRowToMovie,
  shouldAutoSyncCheck,
  markSyncCheckDone,
  type SyncPlan,
  type SyncRow,
} from "../lib/animeEpisodeSync";
import type { Movie } from "../data";

interface Props {
  onAddMovies: (movies: Movie[]) => void;
}

type Phase = "idle" | "checking" | "ready" | "adding" | "done" | "error";

/**
 * Anime Episode Sync panel — "New episode aaya hai kya?" check in one click.
 *
 * Compares every auto-fetched anime collection in Supabase with AniList
 * (aired episode count, including new seasons) and offers to add the missing
 * episodes with the same Nxsha/NHD embed template. Background auto-check
 * runs once every 6 hours when the panel opens.
 */
export default function AnimeEpisodeSyncPanel({ onAddMovies }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [freshRows, setFreshRows] = useState<SyncRow[]>([]);
  const [error, setError] = useState("");
  const [addedCount, setAddedCount] = useState(0);
  const [wasAuto, setWasAuto] = useState(false);
  const startedRef = useRef(false);

  const runCheck = async (auto: boolean) => {
    if (phase === "checking" || phase === "adding") return;
    setPhase("checking");
    setError("");
    setWasAuto(auto);
    try {
      const p = await fetchEpisodeSyncPlan();
      markSyncCheckDone();
      setPlan(p);
      const { fresh } = await dedupeSyncRows(p.movies || []);
      setFreshRows(fresh);
      setPhase("ready");
    } catch (e: unknown) {
      markSyncCheckDone();
      if (auto) {
        // silent background check — don't scare the user
        setPhase("idle");
      } else {
        setError(e instanceof Error ? e.message : "Sync check failed");
        setPhase("error");
      }
    }
  };

  // Auto background check (throttled to once / 6h)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (shouldAutoSyncCheck()) void runCheck(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = () => {
    if (freshRows.length === 0) return;
    setPhase("adding");
    const movies = freshRows.map(syncRowToMovie);
    setAddedCount(movies.length);
    // handleUpload (App.tsx) inserts into Supabase + refreshes the UI
    onAddMovies(movies);
    setPhase("done");
  };

  // Per-collection summary rows
  const collectionSummaries = (plan?.collections || [])
    .map((c) => {
      const seasonBits = c.seasons
        .filter((s) => s.newEpisodes.length > 0 || (s.isNewSeason && s.airedEpisodes > 0))
        .map((s) => ({
          key: `${c.playlistId}-${s.seasonNumber}`,
          label: s.isNewSeason
            ? `S${s.seasonNumber} NAYA SEASON • ${s.newEpisodes.length} ep aired`
            : `S${s.seasonNumber} • ${s.dbEpisodes} → ${s.airedEpisodes} aired • +${s.newEpisodes.length} new`,
        }));
      return {
        playlistId: c.playlistId,
        title: c.playlistTitle,
        status: c.status,
        reason: c.reason,
        bits: seasonBits,
      };
    })
    .filter((c) => c.bits.length > 0 || c.status === "skipped");

  const totalNew = freshRows.length;
  const checkedCollections = plan?.collections?.length || 0;

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
      {/* header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-purple-400" />
          <div>
            <p className="font-bold text-white text-xs">New Episode Auto-Sync</p>
            <p className="text-gray-400 text-[10px]">
              AniList se aired episodes check hota hai — naye episode (aur naye season) apne aap
              suggest ho jate hain, same Nxsha/NHD embed ke saath. Auto-fetch aur rows-system
              (Series tab) — dono tarah ke collections sync hote hain.
            </p>
          </div>
        </div>
        <button
          onClick={() => void runCheck(false)}
          disabled={phase === "checking" || phase === "adding"}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-200 text-[11px] font-bold transition disabled:opacity-50"
        >
          <RefreshCw size={12} className={phase === "checking" ? "animate-spin" : ""} />
          {phase === "checking" ? "Checking..." : "Check New Episodes"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-[11px] bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-2">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {phase === "checking" && (
        <p className="text-purple-300/80 text-[11px] px-1">
          {checkedCollections > 0 ? `${checkedCollections} collections` : "Anime collections"}{" "}
          AniList + Jikan se check ho rahe hain… (10–30 sec lag sakte hain)
        </p>
      )}

      {phase === "ready" && plan && (
        <div className="space-y-1.5">
          {totalNew === 0 && (
            <div className="flex items-center gap-2 text-emerald-300 text-[11px] bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <CheckCircle2 size={13} />
              Sab up-to-date hai! {plan.collections.length} collections check kiye
              {wasAuto ? " (auto-check)" : ""} — koi naya episode nahi mila.
            </div>
          )}

          {collectionSummaries.map((c) => (
            <div
              key={c.playlistId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#161022] border border-purple-500/15 rounded-lg px-3 py-2"
            >
              <span className="text-white text-[11px] font-bold">{c.title}</span>
              {c.bits.map((b) => (
                <span
                  key={b.key}
                  className="text-purple-300 text-[10px] font-mono bg-purple-500/10 border border-purple-500/20 rounded px-1.5 py-0.5"
                >
                  {b.label}
                </span>
              ))}
              {c.status === "skipped" && (
                <span className="text-gray-500 text-[10px] italic">{c.reason}</span>
              )}
            </div>
          ))}

          {totalNew > 0 && (
            <button
              onClick={handleAdd}
              className="w-full flex items-center justify-center gap-2 mt-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:opacity-90 text-white text-xs font-bold transition"
            >
              <Download size={13} />
              Add {totalNew} New Episode{totalNew > 1 ? "s" : ""} to Website
            </button>
          )}
        </div>
      )}

      {phase === "adding" && (
        <p className="text-purple-300/80 text-[11px] px-1">Episodes add ho rahe hain…</p>
      )}

      {phase === "done" && (
        <div className="flex items-center gap-2 text-emerald-300 text-[11px] bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle2 size={13} />
          {addedCount} episode{addedCount > 1 ? "s" : ""} website par add ho gaye ✅ Ab season ke
          andar dikhenge.
        </div>
      )}
    </div>
  );
}
