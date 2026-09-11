// Minimal types for the existing IFrame API boundary; no runtime dependency.
export interface YouTubeCaptionTrack {
  languageCode?: string;
  vss_id?: string;
  languageName?: string;
  displayName?: string;
}

export interface YouTubePlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { title?: string };
  loadModule(module: string): void;
  unloadModule(module: string): void;
  setOption(module: string, option: string, value: unknown): void;
  getOption(module: string, option: "tracklist"): YouTubeCaptionTrack[] | undefined;
  setPlaybackRate(speed: number): void;
  destroy(): void;
}

export interface YouTubeEvent {
  target: YouTubePlayer;
  data: number;
}

export interface YouTubePlayerOptions {
  videoId: string;
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady(event: YouTubeEvent): void;
    onStateChange(event: YouTubeEvent): void;
    onError?: () => void;
  };
}

export type YouTubeWindow = Window & {
  YT: {
    Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
    PlayerState: Record<"PLAYING" | "PAUSED" | "BUFFERING" | "UNSTARTED" | "ENDED", number>;
  };
  onYouTubeIframeAPIReady?: () => void;
};
