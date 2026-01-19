export type SongSourceId = 'hvsc' | 'local';

export type SongFolder = {
  path: string;
  name: string;
};

export type SongEntry = {
  id: string;
  path: string;
  title: string;
  durationMs?: number;
  source: SongSourceId;
  payload?: unknown;
};

export type SongSource = {
  id: SongSourceId;
  listFolders: (path: string) => Promise<SongFolder[]>;
  listSongs: (path: string) => Promise<SongEntry[]>;
  getSong: (entry: SongEntry) => Promise<{ data: Uint8Array; durationMs?: number; title: string; path?: string }>;
};
