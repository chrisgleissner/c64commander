import type {
  PlaylistItemRecord,
  PlaylistQueryOptions,
  PlaylistQueryResult,
  PlaylistSessionRecord,
  RandomPlaySession,
  TrackRecord,
} from './types';

export interface TrackRepository {
  upsertTracks(tracks: TrackRecord[]): Promise<void>;
  getTracksByIds(trackIds: string[]): Promise<Map<string, TrackRecord>>;
}

export interface PlaylistRepository {
  replacePlaylistItems(playlistId: string, items: PlaylistItemRecord[]): Promise<void>;
  getPlaylistItems(playlistId: string): Promise<PlaylistItemRecord[]>;
  saveSession(session: PlaylistSessionRecord): Promise<void>;
  getSession(playlistId: string): Promise<PlaylistSessionRecord | null>;
}

export interface PlaylistQueryRepository {
  queryPlaylist(options: PlaylistQueryOptions): Promise<PlaylistQueryResult>;
}

export interface RandomPlayRepository {
  createSession(playlistId: string, orderedPlaylistItemIds: string[], seed?: number): Promise<RandomPlaySession>;
  next(playlistId: string): Promise<string | null>;
  getRandomSession(playlistId: string): Promise<RandomPlaySession | null>;
  saveRandomSession(session: RandomPlaySession): Promise<void>;
}

export interface PlaylistDataRepository
  extends TrackRepository, PlaylistRepository, PlaylistQueryRepository, RandomPlayRepository {}
