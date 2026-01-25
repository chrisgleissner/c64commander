export type MediaType = 'sid' | 'mod' | 'prg' | 'crt' | 'disk';

export type MediaEntry = {
  path: string;
  name: string;
  type: MediaType;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
};

export type MediaIndexSnapshot = {
  version: 1;
  updatedAt: string;
  entries: MediaEntry[];
};

export type MediaIndexStorage = {
  read: () => Promise<MediaIndexSnapshot | null>;
  write: (snapshot: MediaIndexSnapshot) => Promise<void>;
};

export type MediaIndex = {
  load: () => Promise<void>;
  save: () => Promise<void>;
  scan: (paths: string[]) => Promise<void>;
  queryByType: (type: MediaType) => MediaEntry[];
  queryByPath: (path: string) => MediaEntry | null;
  getAll: () => MediaEntry[];
  setEntries: (entries: MediaEntry[]) => void;
};
