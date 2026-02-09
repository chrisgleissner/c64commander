/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
