/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
  songNr?: number;
  subsongCount?: number;
  source: SongSourceId;
  payload?: unknown;
};

export type SongSource = {
  id: SongSourceId;
  listFolders: (path: string) => Promise<SongFolder[]>;
  listSongs: (path: string) => Promise<SongEntry[]>;
  getSong: (entry: SongEntry) => Promise<{ data: Uint8Array; durationMs?: number; title: string; path?: string }>;
};
