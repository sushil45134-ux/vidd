import { useState, useRef, useCallback, useEffect } from "react";
import {
  X,
  Upload,
  Film,
  Play,
  Image,
  Trash2,
  Check,
  Link,
  Globe,
  Layers,
  Wand2,
} from "lucide-react";
import type { Movie } from "../data";
import { youtubeThumbnailSources } from "../lib/media";
import {
  detectEpisodeNumber,
  embedHostLabel,
  extractYouTubeId,
  generateSeasonFromLink,
  splitEmbedPastes,
} from "../lib/episodeLinks";
import {
  isCloudLink,
  isMegaFolderLink,
  parseCloudLink,
  parseDriveLink,
  parseMegaLink,
  splitLinkList,
  type CloudEpisode,
  type CloudProvider,
} from "../lib/cloudLinks";

interface UploadModalProps {
  onClose: () => void;
  onUpload: (movie: Movie | Movie[]) => void;
}

const GENRES = [
  "Action",
  "Adventure",
  "Anime",
  "Cartoon",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
  "War",
  "Superhero",
];
const RATINGS = ["G", "PG", "PG-13", "R", "TV-Y", "TV-G", "TV-PG", "TV-14", "TV-MA"];

/* ── Platform detection & embed URL builders ──────────────────── */
interface PlatformResult {
  platform: string;
  id: string;
  embedUrl: string;
  thumbnail: string;
  color: string;
  icon: string; // emoji
}

function detectPlatform(input: string): PlatformResult | null {
  const trimmed = input.trim();
  // Extract src from iframe embed codes
  const iframeSrc = trimmed.match(/src=["']([^"']+)["']/);
  const url = iframeSrc ? iframeSrc[1] : trimmed;

  // ── YouTube ────────────────────────────────────────────────
  const ytPatterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const p of ytPatterns) {
    const m = url.match(p);
    if (m)
      return {
        platform: "YouTube",
        id: m[1],
        embedUrl: `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0&modestbranding=1`,
        thumbnail: youtubeThumbnailSources(m[1])[0] || "",
        color: "bg-red-600",
        icon: "▶️",
      };
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed))
    return {
      platform: "YouTube",
      id: trimmed,
      embedUrl: `https://www.youtube.com/embed/${trimmed}?autoplay=1&rel=0&modestbranding=1`,
      thumbnail: youtubeThumbnailSources(trimmed)[0] || "",
      color: "bg-red-600",
      icon: "▶️",
    };

  // ── Vimeo ──────────────────────────────────────────────────
  const vimeoMatch = url.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  if (vimeoMatch)
    return {
      platform: "Vimeo",
      id: vimeoMatch[1],
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&title=0&byline=0&portrait=0&transparent=0`,
      thumbnail: "",
      color: "bg-sky-500",
      icon: "🎬",
    };

  // ── Dailymotion ────────────────────────────────────────────
  const dmMatch = url.match(
    /(?:dailymotion\.com\/video\/|dai\.ly\/|dailymotion\.com\/embed\/video\/)([A-Za-z0-9]+)/,
  );
  if (dmMatch)
    return {
      platform: "Dailymotion",
      id: dmMatch[1],
      embedUrl: `https://www.dailymotion.com/embed/video/${dmMatch[1]}?autoplay=1&queue-enable=false&queue-autoplay-next=false&sharing-enable=false&ui-start-screen-info=0&ui-logo=0&ui-menu=0&ui-social-actions=0&ui-highlight=0&endscreen-enable=false&api=postMessage`,
      thumbnail: `https://www.dailymotion.com/thumbnail/video/${dmMatch[1]}`,
      color: "bg-blue-600",
      icon: "📺",
    };

  // ── Bilibili ───────────────────────────────────────────────
  const biliMatch = url.match(
    /(?:bilibili\.com\/video\/(BV[A-Za-z0-9]+)|player\.bilibili\.com\/player\.html\?.*bvid=(BV[A-Za-z0-9]+)|player\.bilibili\.com\/player\.html\?.*aid=(\d+))/,
  );
  if (biliMatch) {
    const bvid = biliMatch[1] || biliMatch[2];
    const aid = biliMatch[3];
    if (bvid)
      return {
        platform: "Bilibili",
        id: bvid,
        embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&high_quality=1&danmaku=0&as_wide=1`,
        thumbnail: "",
        color: "bg-pink-500",
        icon: "📱",
      };
    if (aid)
      return {
        platform: "Bilibili",
        id: aid,
        embedUrl: `https://player.bilibili.com/player.html?aid=${aid}&autoplay=1&high_quality=1&danmaku=0&as_wide=1`,
        thumbnail: "",
        color: "bg-pink-500",
        icon: "📱",
      };
  }

  // ── Twitch ─────────────────────────────────────────────────
  const twitchVod = url.match(/(?:twitch\.tv\/videos\/)(\d+)/);
  if (twitchVod)
    return {
      platform: "Twitch",
      id: twitchVod[1],
      embedUrl: `https://player.twitch.tv/?video=${twitchVod[1]}&parent=${location.hostname}&autoplay=true`,
      thumbnail: "",
      color: "bg-purple-600",
      icon: "🎮",
    };
  const twitchClip = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([A-Za-z0-9_-]+)/);
  if (twitchClip)
    return {
      platform: "Twitch",
      id: twitchClip[1],
      embedUrl: `https://clips.twitch.tv/embed?clip=${twitchClip[1]}&parent=${location.hostname}&autoplay=true`,
      thumbnail: "",
      color: "bg-purple-600",
      icon: "🎮",
    };

  // ── Facebook Video ─────────────────────────────────────────
  const fbMatch = url.match(
    /(?:facebook\.com|fb\.watch).*(?:\/videos\/|\/watch\/|\/reel\/|v=)(\d+)/,
  );
  if (fbMatch)
    return {
      platform: "Facebook",
      id: fbMatch[1],
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&autoplay=true`,
      thumbnail: "",
      color: "bg-blue-700",
      icon: "📘",
    };

  // ── Streamable ─────────────────────────────────────────────
  const streamableMatch = url.match(/streamable\.com\/(?:e\/)?([a-z0-9]+)/i);
  if (streamableMatch)
    return {
      platform: "Streamable",
      id: streamableMatch[1],
      embedUrl: `https://streamable.com/e/${streamableMatch[1]}?autoplay=1`,
      thumbnail: `https://cdn-cf-east.streamable.com/image/${streamableMatch[1]}.jpg`,
      color: "bg-teal-600",
      icon: "🔗",
    };

  // ── Odysee / LBRY ───────────────────────────────────────────
  const odyseeEmbed = url.match(/odysee\.com\/\$\/embed\/([^/]+)\/([a-f0-9]+)/);
  if (odyseeEmbed)
    return {
      platform: "Odysee",
      id: odyseeEmbed[2],
      embedUrl: `https://odysee.com/$/embed/${odyseeEmbed[1]}/${odyseeEmbed[2]}?autoplay=1`,
      thumbnail: `https://thumbnails.odycdn.com/optimize/s:390:0/quality:85/plain/https://thumbs.odycdn.com/${odyseeEmbed[2]}.webp`,
      color: "bg-pink-600",
      icon: "🌊",
    };
  const odyseeWatch = url.match(/odysee\.com\/(@[^/]+)\/([^?#]+)/);
  if (odyseeWatch)
    return {
      platform: "Odysee",
      id: odyseeWatch[2],
      embedUrl: `https://odysee.com/$/embed/${odyseeWatch[2]}?autoplay=1`,
      thumbnail: "",
      color: "bg-pink-600",
      icon: "🌊",
    };

  // ── BitChute ───────────────────────────────────────────────
  const bitchuteEmbed = url.match(/bitchute\.com\/embed\/([A-Za-z0-9]+)/);
  if (bitchuteEmbed)
    return {
      platform: "BitChute",
      id: bitchuteEmbed[1],
      embedUrl: `https://www.bitchute.com/embed/${bitchuteEmbed[1]}/`,
      thumbnail: `https://www.bitchute.com/thumbnail/${bitchuteEmbed[1]}.jpg`,
      color: "bg-emerald-700",
      icon: "🎥",
    };
  const bitchuteVideo = url.match(/bitchute\.com\/video\/([A-Za-z0-9]+)/);
  if (bitchuteVideo)
    return {
      platform: "BitChute",
      id: bitchuteVideo[1],
      embedUrl: `https://www.bitchute.com/embed/${bitchuteVideo[1]}/`,
      thumbnail: `https://www.bitchute.com/thumbnail/${bitchuteVideo[1]}.jpg`,
      color: "bg-emerald-700",
      icon: "🎥",
    };

  // ── Rumble ─────────────────────────────────────────────────
  const rumbleEmbed = url.match(/rumble\.com\/embed\/([A-Za-z0-9]+)/);
  if (rumbleEmbed)
    return {
      platform: "Rumble",
      id: rumbleEmbed[1],
      embedUrl: `https://rumble.com/embed/${rumbleEmbed[1]}/?autoplay=1`,
      thumbnail: "",
      color: "bg-green-700",
      icon: "📢",
    };

  // ── PeerTube (generic) ─────────────────────────────────────
  const peertubeMatch = url.match(/(https?:\/\/[^/]+)\/(?:videos\/watch|w)\/([a-f0-9-]+)/);
  if (peertubeMatch)
    return {
      platform: "PeerTube",
      id: peertubeMatch[2],
      embedUrl: `${peertubeMatch[1]}/videos/embed/${peertubeMatch[2]}?autoplay=1`,
      thumbnail: `${peertubeMatch[1]}/lazy-static/previews/${peertubeMatch[2]}.jpg`,
      color: "bg-orange-600",
      icon: "🌐",
    };

  // ── MEGA ───────────────────────────────────────────────────
  const megaLink = parseMegaLink(url);
  if (megaLink)
    return {
      platform: "MEGA",
      id: megaLink.fileId,
      embedUrl: megaLink.embedUrl,
      thumbnail: "",
      color: "bg-red-600",
      icon: "📦",
    };

  // ── Google Drive ───────────────────────────────────────────
  const driveLink = parseDriveLink(url);
  if (driveLink)
    return {
      platform: "Google Drive",
      id: driveLink.fileId,
      embedUrl: driveLink.embedUrl,
      thumbnail: "",
      color: "bg-green-600",
      icon: "📁",
    };

  // ── Generic iframe / direct embed URL ──────────────────────
  // If it looks like a URL with a video embed path
  if (
    /^https?:\/\/.+/i.test(url) &&
    (url.includes("embed") ||
      url.includes("player") ||
      url.includes("/e/") ||
      url.includes("iframe") ||
      iframeSrc)
  ) {
    const hostname = (() => {
      try {
        return new URL(url).hostname.replace("www.", "");
      } catch {
        return "Embed";
      }
    })();
    return {
      platform: hostname.charAt(0).toUpperCase() + hostname.slice(1).split(".")[0],
      id: url,
      embedUrl: url,
      thumbnail: "",
      color: "bg-gray-600",
      icon: "🌐",
    };
  }

  return null;
}

/* ── Supported platforms info ─────────────────────────────────── */
const PLATFORMS = [
  { name: "YouTube", examples: ["youtube.com/watch?v=...", "youtu.be/..."], color: "text-red-400" },
  { name: "Odysee", examples: ["odysee.com/@channel/video", "embed link"], color: "text-pink-400" },
  {
    name: "BitChute",
    examples: ["bitchute.com/video/...", "embed link"],
    color: "text-emerald-400",
  },
  { name: "Vimeo", examples: ["vimeo.com/123456"], color: "text-sky-400" },
  {
    name: "Dailymotion",
    examples: ["dailymotion.com/video/...", "dai.ly/..."],
    color: "text-blue-400",
  },
  { name: "Bilibili", examples: ["bilibili.com/video/BV..."], color: "text-pink-400" },
  {
    name: "Twitch",
    examples: ["twitch.tv/videos/...", "clips.twitch.tv/..."],
    color: "text-purple-400",
  },
  { name: "Rumble", examples: ["rumble.com/embed/..."], color: "text-green-400" },
  { name: "Streamable", examples: ["streamable.com/..."], color: "text-teal-400" },
  { name: "Facebook", examples: ["facebook.com/.../videos/..."], color: "text-blue-500" },
  { name: "Google Drive", examples: ["drive.google.com/file/d/.../view"], color: "text-green-400" },
  {
    name: "MEGA",
    examples: ["mega.nz/file/...#key", "mega.nz/embed/...#key"],
    color: "text-red-400",
  },
  { name: "Any embed", examples: ["Paste any <iframe> embed code"], color: "text-gray-400" },
];

type CloudTab = CloudProvider; // "drive" | "mega"
type SourceTab = "file" | "embed" | "series" | CloudTab;

/** One episode row in the "Series" (bulk embed) tab. */
interface EmbedEpisode {
  id: string;
  title: string;
  url: string;
  host: string;
}

const epTitleNumber = (title: string): number => {
  const m = title.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 9999;
};

/* ── Cloud series (Google Drive / MEGA) helpers ───────────────── */
interface CloudTabConfig {
  /** Display name used in badges and platform labels. */
  name: string;
  /** Value stored on Movie.embedPlatform. */
  platform: string;
  placeholder: string;
  tip: string;
  invalidError: string;
  folderError?: string;
}

const CLOUD_TABS: Record<CloudTab, CloudTabConfig> = {
  drive: {
    name: "Google Drive",
    platform: "Google Drive",
    placeholder:
      "Paste all Google Drive video links here — one per line:\n\nhttps://drive.google.com/file/d/FILE_ID_1/view\nhttps://drive.google.com/file/d/FILE_ID_2/view\nhttps://drive.google.com/file/d/FILE_ID_3/view\n...",
    tip: 'Open your Google Drive folder → select all videos → right-click → "Get link" → copy all links and paste them here at once. Each link becomes one episode.',
    invalidError: "Could not extract file ID. Make sure you paste Google Drive file links.",
  },
  mega: {
    name: "MEGA",
    platform: "MEGA",
    placeholder:
      "Paste all MEGA video links here — one per line:\n\nhttps://mega.nz/file/HANDLE_1#KEY_1\nhttps://mega.nz/file/HANDLE_2#KEY_2\nhttps://mega.nz/embed/HANDLE_3#KEY_3\n...",
    tip: 'Open your MEGA folder → right-click a video → "Get link" (or "Embed code") → copy the link with its #key and paste all episode links here. Only MP4/WebM videos can be embedded, and the link must stay shared.',
    invalidError:
      "Could not read that MEGA link. Paste file links like https://mega.nz/file/HANDLE#KEY (the #key part is required).",
    folderError:
      "MEGA folder links can't be expanded into episodes. Open the folder, copy each video's own link and paste those instead.",
  },
};

function CloudIcon({ provider, className }: { provider: CloudTab; className?: string }) {
  if (provider === "mega") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 5h4.2L12 12.2 16.8 5H21v14h-3.4v-8.2l-4 6h-3.2l-4-6V19H3z" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 87.3 78" fill="currentColor" aria-hidden="true">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" />
      <path d="M43.65 25.15L29.9 1.35C28.55 2.15 27.4 3.25 26.6 4.65L1.2 48.2C.4 49.6 0 51.15 0 52.7h27.5l16.15-27.55z" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85L46.1 76.8h27.45z" />
      <path d="M43.65 25.15L57.4 1.35C56.05.55 54.5.15 52.95.15h-18.6c-1.55 0-3.1.4-4.5 1.2l13.8 23.8z" />
      <path d="M59.8 53H27.5l-13.75 23.8c1.4.8 2.95 1.2 4.5 1.2h50.5c1.55 0 3.1-.4 4.5-1.2L59.8 53z" />
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25.15 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5L73.4 26.5z" />
    </svg>
  );
}

/* ── Component ────────────────────────────────────────────────── */
export default function UploadModal({ onClose, onUpload }: UploadModalProps) {
  const [sourceTab, setSourceTab] = useState<SourceTab>("file");
  const [step, setStep] = useState<"upload" | "details" | "done">("upload");

  // File state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Embed state
  const [embedInput, setEmbedInput] = useState("");
  const [detected, setDetected] = useState<PlatformResult | null>(null);
  const [embedError, setEmbedError] = useState("");

  // Cloud series state (Google Drive / MEGA share links)
  const [cloudInputs, setCloudInputs] = useState<Record<CloudTab, string>>({ drive: "", mega: "" });
  const [cloudEpisodes, setCloudEpisodes] = useState<Record<CloudTab, CloudEpisode[]>>({
    drive: [],
    mega: [],
  });
  const [cloudErrors, setCloudErrors] = useState<Record<CloudTab, string>>({ drive: "", mega: "" });
  const [seriesTitle, setSeriesTitle] = useState("");

  // Series (bulk embed) state — paste many iframes → one series with seasons
  const [embedEpisodes, setEmbedEpisodes] = useState<EmbedEpisode[]>([]);
  const [embedSeason, setEmbedSeason] = useState(1);
  const [embedSeriesError, setEmbedSeriesError] = useState("");
  const [autoTotal, setAutoTotal] = useState(12);

  // The active cloud tab, when the user picked the Drive or MEGA source tab.
  const cloudTab: CloudTab | null =
    sourceTab === "drive" || sourceTab === "mega" ? sourceTab : null;
  const isSeriesSource = cloudTab !== null || sourceTab === "series";
  const cloudConfig = cloudTab ? CLOUD_TABS[cloudTab] : null;
  const cloudEps = cloudTab ? cloudEpisodes[cloudTab] : [];
  const cloudInput = cloudTab ? cloudInputs[cloudTab] : "";
  const cloudError = cloudTab ? cloudErrors[cloudTab] : "";

  // Shared details
  const [, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [rating, setRating] = useState("PG-13");
  const [year, setYear] = useState(2024);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
      if (videoUrl && videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
      if (thumbnailUrl && thumbnailUrl.startsWith("blob:")) URL.revokeObjectURL(thumbnailUrl);
      if (videoPreviewUrl && videoPreviewUrl.startsWith("blob:"))
        URL.revokeObjectURL(videoPreviewUrl);
    };
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  // ── File handlers ──────────────────────────────────────────
  const handleVideoSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/")) {
        alert("Please select a valid video file");
        return;
      }
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoPreviewUrl(url);
      const name = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      if (!title) setTitle(name.charAt(0).toUpperCase() + name.slice(1));
      setIsProcessing(true);
      setUploadProgress(0);
      const interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setIsProcessing(false);
            return 100;
          }
          return prev + Math.random() * 15 + 5;
        });
      }, 200);
    },
    [title],
  );

  const handleThumbnailSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }
    setThumbnailFile(file);
    setThumbnailUrl(URL.createObjectURL(file));
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleVideoSelect(e.dataTransfer.files[0]);
  };

  const generateThumbnailFromVideo = useCallback(() => {
    if (!videoPreviewRef.current) return;
    const v = videoPreviewRef.current;
    const c = document.createElement("canvas");
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 360;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      setThumbnailUrl(c.toDataURL("image/jpeg", 0.8));
    }
  }, []);

  const removeVideo = () => {
    if (videoUrl && videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl("");
    setVideoPreviewUrl("");
    setUploadProgress(0);
  };

  // ── Embed handlers ─────────────────────────────────────────
  const handleEmbedInput = (val: string) => {
    setEmbedInput(val);
    setEmbedError("");
    const result = detectPlatform(val);
    setDetected(result);
    if (result) {
      if (!title) setTitle(`${result.platform} Video`);
      if (result.thumbnail) setThumbnailUrl(result.thumbnail);
    }
  };

  const clearEmbed = () => {
    setEmbedInput("");
    setDetected(null);
    setEmbedError("");
    setThumbnailUrl("");
  };

  const hasSource =
    sourceTab === "file"
      ? !!videoFile && !isProcessing
      : sourceTab === "embed"
        ? !!detected
        : sourceTab === "series"
          ? embedEpisodes.length > 0
          : cloudEpisodes[sourceTab].length > 0;

  // ── Cloud (Drive / MEGA) episode handlers ──────────────────
  const addCloudLinks = (tab: CloudTab) => {
    const config = CLOUD_TABS[tab];
    const val = cloudInputs[tab].trim();
    if (!val) return;
    // Support pasting multiple links (one per line, comma, or space separated)
    const lines = splitLinkList(val);
    const existing = cloudEpisodes[tab];
    const newEps: CloudEpisode[] = [];
    let badLink = "";
    let folderLink = false;
    for (const line of lines) {
      if (!isCloudLink(tab, line)) continue;
      if (tab === "mega" && isMegaFolderLink(line)) {
        folderLink = true;
        continue;
      }
      const parsed = parseCloudLink(tab, line);
      if (!parsed) {
        badLink = line;
        continue;
      }
      if (
        existing.some((e) => e.fileId === parsed.fileId) ||
        newEps.some((e) => e.fileId === parsed.fileId)
      )
        continue;
      newEps.push({
        id: `${Date.now()}-${Math.random()}`,
        fileId: parsed.fileId,
        title: `Episode ${existing.length + newEps.length + 1}`,
        url: parsed.embedUrl,
      });
    }
    if (newEps.length === 0 && folderLink && config.folderError) {
      setCloudErrors((prev) => ({ ...prev, [tab]: config.folderError! }));
      return;
    }
    if (newEps.length === 0 && badLink) {
      setCloudErrors((prev) => ({ ...prev, [tab]: config.invalidError }));
      return;
    }
    if (newEps.length === 0 && lines.length > 0) {
      setCloudErrors((prev) => ({
        ...prev,
        [tab]: "No new valid links found. Links may be duplicates or invalid.",
      }));
      return;
    }
    setCloudEpisodes((prev) => ({ ...prev, [tab]: [...prev[tab], ...newEps] }));
    setCloudInputs((prev) => ({ ...prev, [tab]: "" }));
    setCloudErrors((prev) => ({ ...prev, [tab]: "" }));
  };

  const removeCloudEp = (tab: CloudTab, id: string) =>
    setCloudEpisodes((prev) => ({ ...prev, [tab]: prev[tab].filter((e) => e.id !== id) }));
  const updateCloudEpTitle = (tab: CloudTab, id: string, newTitle: string) =>
    setCloudEpisodes((prev) => ({
      ...prev,
      [tab]: prev[tab].map((e) => (e.id === id ? { ...e, title: newTitle } : e)),
    }));

  // ── Series (bulk embed) handlers ───────────────────────────
  const makeEmbedEpisode = (url: string, fallbackNum: number): EmbedEpisode => {
    const detected = detectEpisodeNumber(url);
    return {
      id: `${Date.now()}-${Math.random()}`,
      title: `Episode ${detected ?? fallbackNum}`,
      url,
      host: embedHostLabel(url),
    };
  };

  /** Parse every iframe/URL in the textarea and append them as episodes. */
  const addEmbedEpisodes = () => {
    const { urls } = splitEmbedPastes(embedInput);
    if (urls.length === 0) {
      setEmbedSeriesError(
        "Koi valid link/iframe nahi mila. Pura <iframe> code ya direct video URL paste karo.",
      );
      return;
    }
    setEmbedEpisodes((prev) => {
      const next = [...prev];
      for (const url of urls) {
        if (next.some((e) => e.url === url)) continue;
        next.push(makeEmbedEpisode(url, next.length + 1));
      }
      return next.sort((a, b) => epTitleNumber(a.title) - epTitleNumber(b.title));
    });
    setEmbedInput("");
    setEmbedSeriesError("");
  };

  /**
   * Try to build a whole season from ONE episode link by auto-incrementing the
   * episode number inside the URL. Works only when the link contains a
   * recognisable episode number — hash-only hosts need manual pastes.
   */
  const autoFillSeason = () => {
    const total = Math.max(1, Math.min(500, Math.floor(autoTotal || embedEpisodes.length || 1)));
    const seed = embedEpisodes[0]?.url ?? splitEmbedPastes(embedInput).urls[0];
    if (!seed) {
      setEmbedSeriesError(
        "Pehle Episode 1 ka iframe/link paste karo (textarea me ya list me add karke), phir Auto-fill dabao.",
      );
      return;
    }
    const gen = generateSeasonFromLink(seed, total);
    const baseEp = gen.baseEpisode ?? 1;
    const seedEp = makeEmbedEpisode(seed, baseEp);
    seedEp.title = `Episode ${baseEp}`;

    if (!gen.ok || !gen.urls) {
      setEmbedSeriesError(
        `Episode number link me detect nahi hua (ye host har episode ke liye alag hash use karta hai), isliye auto-generate possible nahi. Saare episodes ke iframe ek saath paste karke "Add Episodes" dabao — Episode ${baseEp} list me add ho gaya hai.`,
      );
      setEmbedEpisodes((prev) =>
        prev.some((e) => e.url === seedEp.url)
          ? prev
          : [...prev, seedEp].sort((a, b) => epTitleNumber(a.title) - epTitleNumber(b.title)),
      );
      setEmbedInput("");
      return;
    }

    const generated = [seedEp, ...gen.urls.map((u, i) => makeEmbedEpisode(u, baseEp + 1 + i))];
    setEmbedEpisodes((prev) => {
      const merged = [...prev];
      for (const ep of generated) {
        if (!merged.some((e) => e.url === ep.url)) merged.push(ep);
      }
      return merged.sort((a, b) => epTitleNumber(a.title) - epTitleNumber(b.title));
    });
    setEmbedInput("");
    setEmbedSeriesError("");
  };

  const removeEmbedEp = (id: string) => setEmbedEpisodes((prev) => prev.filter((e) => e.id !== id));
  const updateEmbedEpTitle = (id: string, newTitle: string) =>
    setEmbedEpisodes((prev) => prev.map((e) => (e.id === id ? { ...e, title: newTitle } : e)));

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = () => {
    if (cloudTab) {
      // Series mode — create one movie per episode link
      const episodes = cloudEpisodes[cloudTab];
      if (episodes.length === 0) return;
      const sTitle = seriesTitle.trim() || "My Series";
      const fallbackImg =
        "https://images.pexels.com/photos/32728014/pexels-photo-32728014.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";
      const movies: Movie[] = episodes.map((ep, i) => ({
        id: Date.now() + i,
        title: `${sTitle} - ${ep.title}`,
        description: description.trim() || `${sTitle}, ${ep.title}`,
        image: thumbnailUrl || fallbackImg,
        backdrop: thumbnailUrl || undefined,
        year,
        rating,
        duration: "Unknown",
        genre: selectedGenres.length > 0 ? selectedGenres : ["Series"],
        match: 99,
        cast: ["User Upload"],
        creator: "You",
        embedUrl: ep.url,
        embedPlatform: CLOUD_TABS[cloudTab].platform,
        thumbnailUrl: thumbnailUrl || undefined,
      }));
      setStep("done");
      setTimeout(() => onUpload(movies), 1500);
      return;
    }

    if (sourceTab === "series") {
      // Bulk-embed series — one flat episode row per iframe, grouped by
      // playlistId into a single series card with season/episode browser.
      const eps = embedEpisodes;
      if (eps.length === 0) return;
      const sTitle = seriesTitle.trim() || "My Series";
      const season = Math.max(1, Math.floor(embedSeason) || 1);
      const pid = `user-series-${Date.now()}`;
      const fallbackImg =
        "https://images.pexels.com/photos/32728014/pexels-photo-32728014.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";
      const cover = thumbnailUrl || fallbackImg;
      const movies: Movie[] = eps.map((ep, i) => {
        const yt = extractYouTubeId(ep.url);
        return {
          id: Date.now() + i,
          title: ep.title,
          description: description.trim() || `${sTitle} — ${ep.title}`,
          image: cover,
          backdrop: thumbnailUrl || undefined,
          year,
          rating,
          duration: "Unknown",
          genre: selectedGenres.length > 0 ? selectedGenres : ["Series"],
          match: 99,
          cast: ["User Upload"],
          creator: "You",
          youtubeId: yt,
          embedUrl: yt ? undefined : ep.url,
          embedPlatform: yt ? undefined : ep.host,
          thumbnailUrl: thumbnailUrl || undefined,
          playlistId: pid,
          playlistTitle: sTitle,
          episodeNumber: i + 1,
          seasonNumber: season,
        };
      });
      setStep("done");
      setTimeout(() => onUpload(movies), 1500);
      return;
    }

    if (!title.trim()) return;
    if (sourceTab === "embed" && !detected) {
      setEmbedError("Could not detect a valid video URL");
      return;
    }

    const fallbackImg =
      "https://images.pexels.com/photos/32728014/pexels-photo-32728014.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200";

    const movie: Movie = {
      id: Date.now(),
      title: title.trim(),
      description:
        description.trim() ||
        (detected ? `A ${detected.platform} video` : `Uploaded video: ${title}`),
      image: thumbnailUrl || detected?.thumbnail || fallbackImg,
      backdrop: thumbnailUrl || detected?.thumbnail || undefined,
      year,
      rating,
      duration: sourceTab === "file" ? getVideoDuration() : "Unknown",
      genre: selectedGenres.length > 0 ? selectedGenres : ["Uploaded"],
      match: 99,
      cast: ["User Upload"],
      creator: "You",
      videoUrl: sourceTab === "file" ? videoUrl : undefined,
      thumbnailUrl: thumbnailUrl || detected?.thumbnail || undefined,
      youtubeId: detected?.platform === "YouTube" ? detected.id : undefined,
      embedUrl: detected && detected.platform !== "YouTube" ? detected.embedUrl : undefined,
      embedPlatform: detected ? detected.platform : undefined,
    };

    setStep("done");
    setTimeout(() => onUpload(movie), 1500);
  };

  const getVideoDuration = (): string => {
    if (videoPreviewRef.current && videoPreviewRef.current.duration) {
      const d = videoPreviewRef.current.duration;
      const h = Math.floor(d / 3600);
      const m = Math.floor((d % 3600) / 60);
      const s = Math.floor(d % 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
    }
    return "Unknown";
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre)
        ? prev.filter((g) => g !== genre)
        : prev.length < 3
          ? [...prev, genre]
          : prev,
    );
  };

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center bg-black/80 backdrop-blur-sm overflow-y-auto pt-6 pb-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl mx-4 bg-[#181818] rounded-lg overflow-hidden shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Upload size={22} className="text-[#e50914]" />
            <h2 className="text-white text-lg font-bold">Add Movie</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center hover:bg-[#3a3a3a] transition-colors"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Steps */}
        <div className="flex items-center gap-2 px-6 pt-4">
          {["Add Source", "Add Details"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === "done" || (step === "details" && i === 0)
                    ? "bg-green-600 text-white"
                    : (step === "upload" && i === 0) || (step === "details" && i === 1)
                      ? "bg-[#e50914] text-white"
                      : "bg-gray-700 text-gray-400"
                }`}
              >
                {step === "done" || (step === "details" && i === 0) ? <Check size={14} /> : i + 1}
              </div>
              <span
                className={`text-xs ${(step === "upload" && i === 0) || (step === "details" && i === 1) || step === "done" ? "text-white" : "text-gray-500"}`}
              >
                {label}
              </span>
              {i < 1 && <div className="w-8 h-px bg-gray-600 mx-1" />}
            </div>
          ))}
        </div>

        {/* ─── DONE ─── */}
        {step === "done" && (
          <div className="p-10 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center mb-4 animate-bounce">
              <Check size={32} className="text-white" />
            </div>
            <h3 className="text-white text-xl font-bold mb-2">Added Successfully!</h3>
            <p className="text-gray-400 text-sm">
              <span className="text-white font-semibold">
                {isSeriesSource ? seriesTitle.trim() || "My Series" : title}
              </span>
              {(cloudTab
                ? cloudEpisodes[cloudTab].length
                : sourceTab === "series"
                  ? embedEpisodes.length
                  : 0) > 1
                ? ` — ${cloudTab ? cloudEpisodes[cloudTab].length : embedEpisodes.length} episodes —`
                : ""}{" "}
              has been added to your library.
            </p>
          </div>
        )}

        {/* ─── SOURCE STEP ─── */}
        {step === "upload" && (
          <div className="p-6">
            {/* Tabs */}
            <div className="flex gap-1 mb-5 bg-[#111] rounded-lg p-1">
              <button
                onClick={() => setSourceTab("file")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs md:text-sm font-medium transition-all ${sourceTab === "file" ? "bg-[#e50914] text-white" : "text-gray-400 hover:text-white hover:bg-[#222]"}`}
              >
                <Film size={14} /> Upload
              </button>
              <button
                onClick={() => setSourceTab("embed")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs md:text-sm font-medium transition-all ${sourceTab === "embed" ? "bg-[#e50914] text-white" : "text-gray-400 hover:text-white hover:bg-[#222]"}`}
              >
                <Globe size={14} /> Embed
              </button>
              <button
                onClick={() => setSourceTab("series")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs md:text-sm font-medium transition-all ${sourceTab === "series" ? "bg-[#e50914] text-white" : "text-gray-400 hover:text-white hover:bg-[#222]"}`}
              >
                <Layers size={14} /> Series
              </button>
              {(["drive", "mega"] as CloudTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSourceTab(tab)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs md:text-sm font-medium transition-all ${sourceTab === tab ? "bg-[#e50914] text-white" : "text-gray-400 hover:text-white hover:bg-[#222]"}`}
                >
                  <CloudIcon provider={tab} className="w-3.5 h-3.5" />
                  {tab === "drive" ? "Drive" : "MEGA"}
                </button>
              ))}
            </div>

            {/* ── FILE TAB ── */}
            {sourceTab === "file" && (
              <>
                {!videoFile ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => videoInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-all ${dragOver ? "border-[#e50914] bg-[#e50914]/10" : "border-gray-600 hover:border-gray-400 hover:bg-[#222]"}`}
                  >
                    <Film
                      size={48}
                      className={`mx-auto mb-4 ${dragOver ? "text-[#e50914]" : "text-gray-500"}`}
                    />
                    <p className="text-white text-lg font-medium mb-2">
                      Drag & drop your video here
                    </p>
                    <p className="text-gray-400 text-sm mb-4">or click to browse files</p>
                    <p className="text-gray-600 text-xs">Supports MP4, WebM, MOV, AVI, MKV</p>
                  </div>
                ) : (
                  <div>
                    <div className="relative rounded-lg overflow-hidden bg-black mb-4">
                      <video
                        ref={videoPreviewRef}
                        src={videoPreviewUrl}
                        className="w-full h-48 md:h-64 object-contain bg-black"
                        controls={false}
                        muted
                        onLoadedData={() => {
                          if (videoPreviewRef.current) videoPreviewRef.current.currentTime = 1;
                        }}
                        onSeeked={generateThumbnailFromVideo}
                      />
                      {isProcessing && (
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
                          <div className="w-48 h-1.5 bg-gray-700 rounded-full overflow-hidden mb-3">
                            <div
                              className="h-full bg-[#e50914] rounded-full transition-all duration-200"
                              style={{ width: `${Math.min(uploadProgress, 100)}%` }}
                            />
                          </div>
                          <p className="text-white text-sm">
                            Processing... {Math.min(Math.round(uploadProgress), 100)}%
                          </p>
                        </div>
                      )}
                      {!isProcessing && (
                        <button
                          onClick={() => {
                            if (videoPreviewRef.current) {
                              videoPreviewRef.current.paused
                                ? videoPreviewRef.current.play()
                                : videoPreviewRef.current.pause();
                            }
                          }}
                          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors group"
                        >
                          <div className="w-14 h-14 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center">
                            <Play size={24} className="text-white ml-1" fill="white" />
                          </div>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 bg-[#222] rounded-lg px-4 py-3">
                      <Film size={20} className="text-[#e50914] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{videoFile.name}</p>
                        <p className="text-gray-400 text-xs">
                          {(videoFile.size / (1024 * 1024)).toFixed(1)} MB • {videoFile.type}
                        </p>
                      </div>
                      <button
                        onClick={removeVideo}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                )}
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleVideoSelect(f);
                  }}
                />
              </>
            )}

            {/* ── EMBED TAB ── */}
            {sourceTab === "embed" && (
              <div>
                {!detected ? (
                  <>
                    {/* Input */}
                    <div className="mb-4">
                      <label className="text-gray-300 text-sm font-medium mb-2 block">
                        Paste Video URL or Embed Code
                      </label>
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                          <Link size={16} />
                        </div>
                        <textarea
                          value={embedInput}
                          onChange={(e) => handleEmbedInput(e.target.value)}
                          placeholder={
                            "https://www.youtube.com/watch?v=...\nhttps://vimeo.com/123456\nhttps://mega.nz/file/HANDLE#KEY\nor paste any <iframe> embed code"
                          }
                          className="w-full bg-[#333] border border-gray-600 rounded px-4 py-3 pl-10 text-white text-sm outline-none focus:border-[#e50914] transition-colors placeholder-gray-500 resize-none min-h-[80px]"
                          rows={3}
                        />
                      </div>
                      {embedError && <p className="text-red-500 text-xs mt-2">{embedError}</p>}

                      {/* Paste from clipboard */}
                      <button
                        onClick={async () => {
                          try {
                            const text = await navigator.clipboard.readText();
                            if (text) handleEmbedInput(text);
                          } catch {
                            setEmbedError("Could not read clipboard. Please paste manually.");
                          }
                        }}
                        className="mt-3 flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Paste from clipboard
                      </button>
                    </div>

                    {/* Supported platforms grid */}
                    <div className="bg-[#111] rounded-lg p-4">
                      <p className="text-gray-400 text-xs font-medium mb-3">Supported platforms:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {PLATFORMS.map((p) => (
                          <div key={p.name} className="flex items-start gap-2 text-xs">
                            <span className={`font-bold mt-0.5 ${p.color}`}>●</span>
                            <div>
                              <span className="text-gray-200 font-medium">{p.name}</span>
                              <p className="text-gray-500 text-[10px]">{p.examples.join(", ")}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Detected preview */}
                    <div className="relative rounded-lg overflow-hidden bg-black mb-4">
                      <div
                        className="w-full"
                        style={{ paddingTop: "56.25%", position: "relative" }}
                      >
                        <iframe
                          src={detected.embedUrl.replace("autoplay=1", "autoplay=0")}
                          className="absolute inset-0 w-full h-full"
                          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          title="Preview"
                        />
                      </div>
                    </div>

                    {/* Platform info bar */}
                    <div className="flex items-center gap-3 bg-[#222] rounded-lg px-4 py-3">
                      <span
                        className={`w-8 h-8 ${detected.color} rounded flex items-center justify-center text-sm flex-shrink-0`}
                      >
                        {detected.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{detected.platform} Video</p>
                        <p className="text-gray-400 text-xs font-mono truncate">
                          ID:{" "}
                          {detected.id.length > 40 ? detected.id.slice(0, 40) + "..." : detected.id}
                        </p>
                      </div>
                      <button
                        onClick={clearEmbed}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── SERIES TAB (bulk embed — paste whole season of iframes) ── */}
            {sourceTab === "series" && (
              <div>
                {/* Series title */}
                <div className="mb-4">
                  <label className="text-gray-300 text-sm font-medium mb-2 block">
                    Series Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={seriesTitle}
                    onChange={(e) => setSeriesTitle(e.target.value)}
                    placeholder="e.g. Demon Slayer"
                    className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-[#e50914] transition-colors placeholder-gray-500"
                    maxLength={100}
                  />
                </div>

                {/* Season + auto-fill target */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="text-gray-300 text-sm font-medium mb-2 block">
                      Season Number
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={embedSeason}
                      onChange={(e) =>
                        setEmbedSeason(Math.min(50, Math.max(1, Number(e.target.value) || 1)))
                      }
                      className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-[#e50914] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-gray-300 text-sm font-medium mb-2 block">
                      Episodes in Season
                      <span className="text-gray-500 text-[10px] ml-1">(auto-fill ke liye)</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={autoTotal}
                      onChange={(e) =>
                        setAutoTotal(Math.min(500, Math.max(1, Number(e.target.value) || 1)))
                      }
                      className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-[#e50914] transition-colors"
                    />
                  </div>
                </div>

                {/* Paste area */}
                <div className="mb-3">
                  <label className="text-gray-300 text-sm font-medium mb-2 block">
                    Episode Embeds
                    <span className="text-gray-500 text-xs ml-2">
                      (saare iframes / links ek saath paste karo)
                    </span>
                  </label>
                  <textarea
                    value={embedInput}
                    onChange={(e) => {
                      setEmbedInput(e.target.value);
                      setEmbedSeriesError("");
                    }}
                    placeholder={
                      'Paste episode iframes or links — one per line:\n\n<iframe src="https://host.com/video/1" ...></iframe>\n<iframe src="https://host.com/video/2" ...></iframe>\nhttps://www.youtube.com/watch?v=...\n...'
                    }
                    className="w-full bg-[#333] border border-gray-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-[#e50914] transition-colors placeholder-gray-500 resize-none min-h-[110px] font-mono text-xs"
                    rows={5}
                  />
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={addEmbedEpisodes}
                      className="px-4 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors flex items-center gap-2"
                    >
                      <Layers size={14} /> Add Episodes
                    </button>
                    <button
                      onClick={autoFillSeason}
                      className="px-4 py-2 rounded border border-[#e50914]/60 bg-[#e50914]/10 text-[#ff6b76] text-sm font-bold hover:bg-[#e50914]/25 transition-colors flex items-center gap-2"
                      title="Episode 1 ke link se poora season auto-generate karo"
                    >
                      <Wand2 size={14} /> Auto-fill Season
                    </button>
                  </div>
                  {embedSeriesError && (
                    <p className="text-red-500 text-xs mt-2 leading-relaxed">{embedSeriesError}</p>
                  )}
                  <p className="text-gray-500 text-[10px] mt-2 leading-relaxed">
                    💡 <span className="text-gray-400">Tip:</span> Har episode ka iframe ya link
                    paste karo — sab apne aap E1, E2, E3... ban jayenge. "Auto-fill Season" tab kaam
                    karega jab link me episode number ho (jaise ?ep=1 ya /episode-1). Hash-wale
                    hosts (jaise as-cdn26.top) me har episode ka alag link hota hai — unme saare
                    iframes paste karo.
                  </p>
                </div>

                {/* Episode list */}
                {embedEpisodes.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-gray-300 text-sm font-medium">
                        Season {embedSeason} • {embedEpisodes.length} Episode
                        {embedEpisodes.length > 1 ? "s" : ""}
                      </p>
                      <button
                        onClick={() => setEmbedEpisodes([])}
                        className="text-red-500 text-xs hover:text-red-400"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                      {embedEpisodes.map((ep, i) => (
                        <div
                          key={ep.id}
                          className="flex items-center gap-3 bg-[#222] rounded-lg px-3 py-2.5 group"
                        >
                          <span className="text-gray-500 text-xs font-mono w-6 text-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <Layers size={14} className="text-[#e50914] flex-shrink-0" />
                          <input
                            type="text"
                            value={ep.title}
                            onChange={(e) => updateEmbedEpTitle(ep.id, e.target.value)}
                            className="flex-1 bg-transparent text-white text-sm outline-none border-b border-transparent focus:border-gray-500 min-w-0"
                          />
                          <span className="text-gray-600 text-[10px] font-mono hidden md:block">
                            {ep.host}
                          </span>
                          <button
                            onClick={() => removeEmbedEp(ep.id)}
                            className="text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {embedEpisodes.length === 0 && (
                  <div className="bg-[#111] rounded-lg p-6 text-center">
                    <Layers className="w-10 h-10 mx-auto mb-3 text-gray-600" />
                    <p className="text-gray-400 text-sm mb-1">No episodes added yet</p>
                    <p className="text-gray-600 text-xs">
                      Saare episode iframes paste karke "Add Episodes" dabao, ya Auto-fill Season
                      try karo
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── CLOUD SERIES TAB (Google Drive / MEGA) ── */}
            {cloudTab && cloudConfig && (
              <div>
                {/* Series title */}
                <div className="mb-4">
                  <label className="text-gray-300 text-sm font-medium mb-2 block">
                    Series Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={seriesTitle}
                    onChange={(e) => setSeriesTitle(e.target.value)}
                    placeholder="e.g. Breaking Bad Season 1"
                    className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-[#e50914] transition-colors placeholder-gray-500"
                    maxLength={100}
                  />
                </div>

                {/* Add links input */}
                <div className="mb-4">
                  <label className="text-gray-300 text-sm font-medium mb-2 block">
                    {cloudConfig.name} Video Links
                    <span className="text-gray-500 text-xs ml-2">
                      (paste all episode links at once)
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <textarea
                      value={cloudInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCloudInputs((prev) => ({ ...prev, [cloudTab]: value }));
                        setCloudErrors((prev) => ({ ...prev, [cloudTab]: "" }));
                      }}
                      placeholder={cloudConfig.placeholder}
                      className="flex-1 bg-[#333] border border-gray-600 rounded px-3 py-2 text-white text-sm outline-none focus:border-[#e50914] transition-colors placeholder-gray-500 resize-none min-h-[100px]"
                      rows={5}
                    />
                    <button
                      onClick={() => addCloudLinks(cloudTab)}
                      className="self-end px-4 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors flex-shrink-0"
                    >
                      Add
                    </button>
                  </div>
                  {cloudError && <p className="text-red-500 text-xs mt-1">{cloudError}</p>}
                  <p className="text-gray-500 text-[10px] mt-2 leading-relaxed">
                    💡 <span className="text-gray-400">Tip:</span> {cloudConfig.tip}
                  </p>
                </div>

                {/* Episode list */}
                {cloudEps.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-gray-300 text-sm font-medium">
                        {cloudEps.length} Episode{cloudEps.length > 1 ? "s" : ""}
                      </p>
                      <button
                        onClick={() => setCloudEpisodes((prev) => ({ ...prev, [cloudTab]: [] }))}
                        className="text-red-500 text-xs hover:text-red-400"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                      {cloudEps.map((ep, i) => (
                        <div
                          key={ep.id}
                          className="flex items-center gap-3 bg-[#222] rounded-lg px-3 py-2.5 group"
                        >
                          <span className="text-gray-500 text-xs font-mono w-6 text-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <CloudIcon
                            provider={cloudTab}
                            className={`w-4 h-4 flex-shrink-0 ${cloudTab === "mega" ? "text-red-500" : "text-green-500"}`}
                          />
                          <input
                            type="text"
                            value={ep.title}
                            onChange={(e) => updateCloudEpTitle(cloudTab, ep.id, e.target.value)}
                            className="flex-1 bg-transparent text-white text-sm outline-none border-b border-transparent focus:border-gray-500 min-w-0"
                          />
                          <span className="text-gray-600 text-[10px] font-mono hidden md:block">
                            {ep.fileId.slice(0, 8)}...
                          </span>
                          <button
                            onClick={() => removeCloudEp(cloudTab, ep.id)}
                            className="text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {cloudEps.length === 0 && (
                  <div className="bg-[#111] rounded-lg p-6 text-center">
                    <CloudIcon
                      provider={cloudTab}
                      className="w-10 h-10 mx-auto mb-3 text-gray-600"
                    />
                    <p className="text-gray-400 text-sm mb-1">No episodes added yet</p>
                    <p className="text-gray-600 text-xs">
                      Paste {cloudConfig.name} video links above to add episodes
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end mt-6 gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2 rounded text-gray-300 text-sm hover:text-white transition-colors"
              >
                Cancel
              </button>
              {cloudTab ? (
                <button
                  onClick={() => setStep("details")}
                  disabled={cloudEps.length === 0 || !seriesTitle.trim()}
                  className="px-6 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next: Add Details ({cloudEps.length} episode{cloudEps.length !== 1 ? "s" : ""})
                </button>
              ) : sourceTab === "series" ? (
                <button
                  onClick={() => setStep("details")}
                  disabled={embedEpisodes.length === 0 || !seriesTitle.trim()}
                  className="px-6 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next: Add Details ({embedEpisodes.length} episode
                  {embedEpisodes.length !== 1 ? "s" : ""})
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (sourceTab === "embed" && embedInput && !detected) {
                      setEmbedError(
                        "Could not detect a video. Try pasting a direct URL or embed code.",
                      );
                      return;
                    }
                    setStep("details");
                  }}
                  disabled={!hasSource}
                  className="px-6 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next: Add Details
                </button>
              )}
            </div>
          </div>
        )}

        {/* ─── DETAILS STEP ─── */}
        {step === "details" && (
          <div className="p-6 space-y-5">
            {/* Source badge */}
            <div className="flex items-center gap-2">
              {cloudTab ? (
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                    cloudTab === "mega"
                      ? "border-red-600/30 bg-red-600/10 text-red-400"
                      : "border-green-600/30 bg-green-600/10 text-green-400"
                  }`}
                >
                  <CloudIcon provider={cloudTab} className="w-3 h-3" />
                  {CLOUD_TABS[cloudTab].name} Series • {cloudEps.length} episode
                  {cloudEps.length !== 1 ? "s" : ""}
                </span>
              ) : sourceTab === "series" ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border border-[#e50914]/40 bg-[#e50914]/10 text-[#ff6b76]">
                  <Layers size={12} />
                  {seriesTitle.trim() || "My Series"} • Season {embedSeason} •{" "}
                  {embedEpisodes.length} episode{embedEpisodes.length !== 1 ? "s" : ""}
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                    detected
                      ? `${detected.color}/20 text-white border-white/10`
                      : "bg-blue-600/20 text-blue-400 border-blue-600/30"
                  }`}
                  style={detected ? { backgroundColor: "rgba(255,255,255,0.08)" } : undefined}
                >
                  {detected ? (
                    <>
                      <span>{detected.icon}</span> {detected.platform}
                    </>
                  ) : (
                    <>
                      <Film size={12} /> Local File
                    </>
                  )}
                </span>
              )}
            </div>

            {/* Thumbnail */}
            <div>
              <label className="text-gray-300 text-sm font-medium mb-2 block">
                Thumbnail Image <span className="text-gray-500 text-xs">(optional)</span>
              </label>
              <div className="flex items-start gap-4">
                <div
                  onClick={() => thumbnailInputRef.current?.click()}
                  className="w-32 h-20 rounded border border-dashed border-gray-600 flex items-center justify-center cursor-pointer hover:border-gray-400 transition-colors overflow-hidden flex-shrink-0 bg-[#222]"
                >
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt="Thumbnail"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <Image size={20} className="text-gray-500 mx-auto mb-1" />
                      <p className="text-gray-500 text-[10px]">Add cover</p>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-gray-400 text-xs leading-relaxed">
                    Upload a cover image or keep the auto-detected one.
                  </p>
                  {thumbnailUrl && (
                    <button
                      onClick={() => {
                        if (thumbnailUrl.startsWith("blob:")) URL.revokeObjectURL(thumbnailUrl);
                        setThumbnailUrl("");
                        setThumbnailFile(null);
                      }}
                      className="text-red-500 text-xs mt-1 hover:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <input
                ref={thumbnailInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleThumbnailSelect(f);
                }}
              />
            </div>

            {/* Title (not for Drive/MEGA series — series title is already set) */}
            {!cloudTab && (
              <div>
                <label className="text-gray-300 text-sm font-medium mb-2 block">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter title..."
                  className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-white transition-colors placeholder-gray-500"
                  maxLength={100}
                />
              </div>
            )}

            {/* Description */}
            <div>
              <label className="text-gray-300 text-sm font-medium mb-2 block">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this about?"
                rows={3}
                className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-white transition-colors placeholder-gray-500 resize-none"
                maxLength={500}
              />
              <p className="text-gray-600 text-xs text-right mt-1">{description.length}/500</p>
            </div>

            {/* Genres */}
            <div>
              <label className="text-gray-300 text-sm font-medium mb-2 block">
                Genres <span className="text-gray-500 text-xs">(up to 3)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${selectedGenres.includes(g) ? "bg-[#e50914] text-white" : "bg-[#333] text-gray-300 hover:bg-[#444]"}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Rating & Year */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-gray-300 text-sm font-medium mb-2 block">Rating</label>
                <select
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-white transition-colors appearance-none cursor-pointer"
                >
                  {RATINGS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-300 text-sm font-medium mb-2 block">Year</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Math.min(2030, Math.max(1900, Number(e.target.value))))}
                  className="w-full bg-[#333] border border-gray-600 rounded px-4 py-2.5 text-white text-sm outline-none focus:border-white transition-colors"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep("upload")}
                className="px-5 py-2 rounded text-gray-300 text-sm hover:text-white transition-colors"
              >
                ← Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded text-gray-300 text-sm hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={
                    isSeriesSource
                      ? cloudTab
                        ? cloudEps.length === 0
                        : embedEpisodes.length === 0
                      : !title.trim()
                  }
                  className="px-6 py-2 rounded bg-[#e50914] text-white text-sm font-bold hover:bg-[#f6121d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Upload size={16} />{" "}
                  {cloudTab
                    ? `Add ${cloudEps.length} Episode${cloudEps.length !== 1 ? "s" : ""}`
                    : sourceTab === "series"
                      ? `Add Series — ${embedEpisodes.length} Episode${embedEpisodes.length !== 1 ? "s" : ""}`
                      : "Add & Play"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
