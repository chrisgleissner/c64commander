export type ScopedEntryType = 'file' | 'dir';

export type ScopedEntry = {
  type: ScopedEntryType;
  name: string;
  path: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type ScopedSourceType = 'ultimate' | 'local';

export type ScopedSelection = {
  type: ScopedEntryType;
  name: string;
  path: string;
};

export type ScopedSource = {
  id: string;
  type: ScopedSourceType;
  name: string;
  rootPath: string;
  isAvailable: boolean;
  listEntries: (path: string) => Promise<ScopedEntry[]>;
  listFilesRecursive: (path: string) => Promise<ScopedEntry[]>;
};