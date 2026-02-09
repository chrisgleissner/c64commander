/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * @deprecated Use src/lib/sources and src/lib/hvsc instead.
 */
export { createLocalFsSongSource } from '@/lib/sources/LocalFsSongSource';
export { HvscSongSource } from '@/lib/hvsc';
export type { LocalSidFile } from '@/lib/sources/LocalFsSongSource';
export type { SongEntry, SongFolder, SongSource, SongSourceId } from '@/lib/sources/SongSource';
