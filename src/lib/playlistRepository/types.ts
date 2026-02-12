export type SourceKind = 'local' | 'ultimate' | 'hvsc';

export type TrackRecord = {
  trackId: string;
  sourceKind: SourceKind;
  sourceLocator: string;
  category?: string | null;
  title: string;
  author?: string | null;
  released?: string | null;
  path: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  defaultDurationMs?: number | null;
  subsongCount?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PlaylistItemRecord = {
  playlistItemId: string;
  playlistId: string;
  trackId: string;
  songNr: number;
  sortKey: string;
  durationOverrideMs?: number | null;
  status: 'ready' | 'unavailable';
  unavailableReason?: 'source-revoked' | 'file-inaccessible' | 'hvsc-unavailable' | null;
  addedAt: string;
};

export type PlaylistSessionRecord = {
  playlistId: string;
  currentPlaylistItemId: string | null;
  isPlaying: boolean;
  isPaused: boolean;
  elapsedMs: number;
  playedMs: number;
  shuffleEnabled: boolean;
  repeatEnabled: boolean;
  randomSeed?: number | null;
  randomCursor?: number | null;
  activeQuery?: string | null;
  updatedAt: string;
};

export type PlaylistQuerySort = 'playlist-position' | 'title' | 'path';

export type PlaylistQueryOptions = {
  playlistId: string;
  query?: string;
  categoryFilter?: string[];
  limit: number;
  offset: number;
  sort?: PlaylistQuerySort;
};

export type PlaylistQueryRow = {
  playlistItem: PlaylistItemRecord;
  track: TrackRecord;
};

export type PlaylistQueryResult = {
  rows: PlaylistQueryRow[];
  totalMatchCount: number;
};

export type RandomPlaySession = {
  playlistId: string;
  seed: number;
  cursor: number;
  order: string[];
};
