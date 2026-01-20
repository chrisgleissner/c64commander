import type { PlayFileCategory, PlaySource, LocalPlayFile } from './playbackRouter';

export type FileLibraryEntry = {
  id: string;
  source: PlaySource;
  sourceId?: string | null;
  name: string;
  path: string;
  category: PlayFileCategory;
  localUri?: string | null;
  durationMs?: number;
  subsongCount?: number;
  addedAt: string;
};

export type FileLibraryRuntime = Record<string, LocalPlayFile>;