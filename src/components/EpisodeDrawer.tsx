import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import SmartImage from "./SmartImage";
import type { Movie } from "../data";
import {
  episodeRowTitle,
  groupEpisodesBySeason,
  toChromeEpisodes,
  type ChromeEpisode,
} from "../lib/playerChrome";

interface EpisodeDrawerProps {
  /** Same-playlistId queue, already sorted by the caller (or not — we sort). */
  episodes: Movie[];
  /** Index of the episode currently on screen. */
  currentIndex: number;
  /** Jump to a queue index (drawer stays open, like Crunchyroll). */
  onSelectIndex: (index: number) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** Optional series name for the drawer header. */
  seriesTitle?: string;
}

/**
 * Crunchyroll-style "Episodes" drawer: slides in from the right over the
 * player, season pills on top, thumbnail rows with the playing episode marked
 * in orange, Prev/Next at the bottom.
 *
 * Rendered only while open, so the ~500-row One Piece queue never costs
 * anything during normal playback.
 */
export default function EpisodeDrawer({
  episodes,
  currentIndex,
  onSelectIndex,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  seriesTitle,
}: EpisodeDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Queue index → drawer row, so season grouping can reorder freely.
  const rows = useMemo(() => {
    const chrome: ChromeEpisode[] = toChromeEpisodes(episodes);
    return chrome.map((ep, index) => ({ ep, index }));
  }, [episodes]);

  const groups = useMemo(() => {
    const byIndex = new Map(rows.map((r) => [r.ep.id, r.index]));
    const grouped = groupEpisodesBySeason(rows.map((r) => r.ep));
    return grouped.map((group) => ({
      ...group,
      episodes: group.episodes.map((ep) => ({ ep, index: byIndex.get(ep.id) ?? -1 })),
    }));
  }, [rows]);

  const current = episodes[currentIndex];

  // Park focus inside the drawer so Tab/D-pad never lands on the hidden
  // player buttons behind it, and scroll the playing row into view.
  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
    const panel = panelRef.current;
    if (!panel) return;
    const active = panel.querySelector<HTMLElement>('[data-playing="true"]');
    if (active) {
      try {
        active.scrollIntoView({ block: "center" });
      } catch {
        /* Old TV browsers ignore the options object — harmless. */
      }
    }
  }, [currentIndex]);

  const showSeasonTabs = groups.length > 1;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Episodes"
      className="cr-drawer absolute right-0 top-0 bottom-0 z-40 flex w-full max-w-[26rem] flex-col bg-[#0b0b0f]/95 backdrop-blur-md sm:max-w-[24rem]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-[#f47521]">
            Episodes
          </h3>
          <p className="truncate text-xs text-white/55">
            {seriesTitle || current?.playlistTitle || "This series"} · {episodes.length} episodes
          </p>
        </div>
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Close episode list"
          title="Close (Esc)"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>

      {/* Season pills */}
      {showSeasonTabs && (
        <div className="flex gap-2 overflow-x-auto border-b border-white/10 px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((group) => {
            const active = group.episodes.some((row) => row.index === currentIndex);
            return (
              <button
                key={group.seasonNumber}
                onClick={() => {
                  const first = group.episodes.find((row) => row.index >= 0);
                  if (first) onSelectIndex(first.index);
                }}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-[#f47521] text-black"
                    : "bg-white/8 text-white/70 hover:bg-white/15 hover:text-white"
                }`}
              >
                S{group.seasonNumber}
              </button>
            );
          })}
        </div>
      )}

      {/* Episode rows */}
      <div className="cr-drawer-scroll flex-1 overflow-y-auto overscroll-contain py-1">
        {groups.map((group) => (
          <div key={group.seasonNumber}>
            {showSeasonTabs && (
              <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-white/35">
                {group.label}
              </p>
            )}
            {group.episodes.map(({ ep, index }) => {
              if (index < 0) return null;
              const playing = index === currentIndex;
              return (
                <button
                  key={ep.id}
                  data-playing={playing ? "true" : undefined}
                  onClick={() => onSelectIndex(index)}
                  aria-current={playing ? "true" : undefined}
                  className={`relative flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                    playing ? "bg-[#f47521]/12" : "hover:bg-white/6"
                  }`}
                >
                  {/* Orange now-playing edge, Crunchyroll style */}
                  {playing && (
                    <span
                      className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#f47521]"
                      aria-hidden
                    />
                  )}

                  <span className="relative block h-[3.1rem] w-[5.5rem] shrink-0 overflow-hidden rounded bg-black/60">
                    <SmartImage
                      src={ep.thumbnail || []}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span
                      className={`absolute inset-0 flex items-center justify-center transition-colors ${
                        playing ? "bg-black/45" : "bg-black/0 hover:bg-black/45"
                      }`}
                    >
                      <Play
                        size={18}
                        fill="white"
                        className={
                          playing
                            ? "text-[#f47521]"
                            : "text-white opacity-0 transition-opacity hover:opacity-100"
                        }
                      />
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] font-semibold ${
                        playing ? "text-[#f47521]" : "text-white"
                      }`}
                    >
                      {episodeRowTitle(ep)}
                    </span>
                    {ep.description && (
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-white/45">
                        {ep.description}
                      </span>
                    )}
                    <span className="mt-1 block text-[10px] uppercase tracking-wide text-white/30">
                      {playing ? "Now playing" : ep.duration || "Episode"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer: prev / next */}
      <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white/8 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#f47521] px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-[#ff8534] disabled:cursor-not-allowed disabled:opacity-30"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
