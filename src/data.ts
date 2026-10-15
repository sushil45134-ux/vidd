/**
 * One language of a multi-audio title.
 *
 * Many anime sources publish a *separate* HLS master per dub (Hindi, Tamil,
 * Japanese…) instead of several `#EXT-X-MEDIA` renditions inside one playlist.
 * Storing them together lets the player offer a real language switch.
 */
export interface AudioSource {
  /** ISO code ('hi', 'ja', …) — used for the readable label. */
  lang: string;
  /** What the viewer sees in the Audio menu, e.g. 'Hindi'. */
  label: string;
  /** That language's playlist / media URL. */
  url: string;
}

export interface Movie {
  id: number;
  title: string;
  description: string;
  image: string;
  backdrop?: string;
  year: number;
  rating: string;
  duration: string;
  genre: string[];
  match: number;
  cast?: string[];
  creator?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  youtubeId?: string;
  embedUrl?: string;
  embedPlatform?: string;
  /** Extra audio languages (separate URLs) for a multi-audio title. */
  audioSources?: AudioSource[];
  /** Database insertion time, used for automatically generated "new today" shelves. */
  createdAt?: string;
  // Playlist / collection grouping
  playlistId?: string;
  playlistTitle?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  isCollection?: boolean;
  episodes?: Movie[];
  seasons?: Season[];
}

export interface Season {
  seasonNumber: number;
  title?: string;
  episodes: Movie[];
}

// Demo content removed — app now only shows user-uploaded and synced videos.
export const featuredMovie: Movie | null = null;
export const trendingNow: Movie[] = [];
export const topRated: Movie[] = [];
export const actionMovies: Movie[] = [];
export const sciFiMovies: Movie[] = [];
export const myListDefault: Movie[] = [];
export const newReleases: Movie[] = [];
export const allMovies: Movie[] = [];

export type Category =
  | "home"
  | "movies"
  | "anime"
  | "cartoon"
  | "ott"
  | "mylist"
  | "discover";
