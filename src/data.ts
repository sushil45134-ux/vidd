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

export type Category = "home" | "movies" | "anime" | "cartoon" | "tvshows" | "new" | "mylist" | "discover";
