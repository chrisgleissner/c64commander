/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlayFileCategory } from '@/lib/playback/fileTypes';
import type { PlayRequest } from '@/lib/playback/playbackRouter';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import type { PlaySource } from '@/lib/playback/playbackRouter';

export type PlayableEntry = {
  source: PlaySource;
  name: string;
  path: string;
  file?: LocalPlayFile;
  durationMs?: number;
  sourceId?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type PlaylistItem = {
  id: string;
  request: PlayRequest;
  category: PlayFileCategory;
  label: string;
  path: string;
  durationMs?: number;
  subsongCount?: number;
  sourceId?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  addedAt?: string | null;
  status?: 'ready' | 'unavailable';
  unavailableReason?: 'source-revoked' | 'file-inaccessible' | 'hvsc-unavailable' | null;
};

export type StoredPlaylistState = {
  items: Array<{
    source: PlaySource;
    path: string;
    name: string;
    durationMs?: number;
    songNr?: number;
    sourceId?: string | null;
    sizeBytes?: number | null;
    modifiedAt?: string | null;
    addedAt?: string | null;
    status?: 'ready' | 'unavailable';
    unavailableReason?: 'source-revoked' | 'file-inaccessible' | 'hvsc-unavailable' | null;
  }>;
  currentIndex?: number;
};

export type StoredPlaybackSession = {
  playlistKey: string;
  currentItemId: string | null;
  currentIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  elapsedMs: number;
  playedMs: number;
  durationMs?: number;
  updatedAt: string;
};
