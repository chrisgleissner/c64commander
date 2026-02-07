import type {
  SongLengthBackendStats,
  SongLengthLoadInput,
  SongLengthResolution,
  SongLengthResolveQuery,
} from './songlengthTypes';

export type SongLengthStoreBackend = {
  readonly backendId: string;
  load: (input: SongLengthLoadInput) => Promise<void>;
  resolve: (query: SongLengthResolveQuery) => SongLengthResolution;
  stats: () => SongLengthBackendStats;
  reset: () => void;
};
