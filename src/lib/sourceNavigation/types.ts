export type SourceEntryType = 'file' | 'dir';

export type SourceEntry = {
  type: SourceEntryType;
  name: string;
  path: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type SourceLocationType = 'ultimate' | 'local' | 'hvsc';

export type SelectedItem = {
  type: SourceEntryType;
  name: string;
  path: string;
};

export type SourceLocation = {
  id: string;
  type: SourceLocationType;
  name: string;
  rootPath: string;
  isAvailable: boolean;
  listEntries: (path: string) => Promise<SourceEntry[]>;
  listFilesRecursive: (path: string) => Promise<SourceEntry[]>;
  clearCacheForPath?: (path: string) => void;
};