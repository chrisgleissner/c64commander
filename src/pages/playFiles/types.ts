import type { PlayFileCategory } from '@/lib/playback/fileTypes';
import type { PlayRequest } from '@/lib/playback/playbackRouter';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import type { PlaySource } from '@/lib/playback/playbackRouter';

export type PlayableEntry = {
  source: PlaySource;
  name: string;
  path: string;
  file?: LocalPlayFile;
  durationMs?: number;
  sourceId?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type PlaylistItem = {
  id: string;
  request: PlayRequest;
  category: PlayFileCategory;
  label: string;
  path: string;
  durationMs?: number;
  subsongCount?: number;
  sourceId?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  addedAt?: string | null;
};

export type StoredPlaylistState = {
  items: Array<{
    source: PlaySource;
    path: string;
    name: string;
    durationMs?: number;
    songNr?: number;
    sourceId?: string | null;
    sizeBytes?: number | null;
    modifiedAt?: string | null;
    addedAt?: string | null;
  }>;
  currentIndex?: number;
};

export type StoredPlaybackSession = {
  playlistKey: string;
  currentItemId: string | null;
  currentIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  elapsedMs: number;
  playedMs: number;
  durationMs?: number;
  updatedAt: string;
};
