/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type {
  SongLengthLoadInput,
  SongLengthResolveQuery,
  SongLengthResolution,
  SongLengthResolveStrategy,
  SongLengthSourceFile,
  SongLengthBackendStats,
  SongLengthServiceStats,
} from './songlengthTypes';
export type { SongLengthStoreBackend } from './songlengthBackend';
export { InMemoryTextBackend, type InMemorySongLengthSnapshot } from './inMemoryTextBackend';
export { SongLengthServiceFacade } from './songlengthService';
