/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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