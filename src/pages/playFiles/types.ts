/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlayRequest } from "@/lib/playback/playbackRouter";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import type { PlaySource } from "@/lib/playback/playbackRouter";
import type { ConfigFileReference } from "@/lib/config/configFileReference";
import type { ArchivePlaylistReference } from "@/lib/archive/types";

export type PlayableEntry = {
  source: PlaySource;
  name: string;
  path: string;
  file?: LocalPlayFile;
  configRef?: ConfigFileReference | null;
  archiveRef?: ArchivePlaylistReference | null;
  durationMs?: number;
  songNr?: number;
  subsongCount?: number;
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
  configRef?: ConfigFileReference | null;
  archiveRef?: ArchivePlaylistReference | null;
  durationMs?: number;
  subsongCount?: number;
  sourceId?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  addedAt?: string | null;
  status?: "ready" | "unavailable";
  unavailableReason?: "source-revoked" | "file-inaccessible" | "hvsc-unavailable" | null;
};

export type StoredPlaylistState = {
  items: Array<{
    source: PlaySource;
    path: string;
    name: string;
    configRef?: ConfigFileReference | null;
    archiveRef?: ArchivePlaylistReference | null;
    durationMs?: number;
    songNr?: number;
    subsongCount?: number;
    sourceId?: string | null;
    sizeBytes?: number | null;
    modifiedAt?: string | null;
    addedAt?: string | null;
    status?: "ready" | "unavailable";
    unavailableReason?: "source-revoked" | "file-inaccessible" | "hvsc-unavailable" | null;
  }>;
  currentIndex?: number;
};

export type StoredPlaybackSession = {
  playlistKey: string;
  currentItemId: string | null;
  currentItemLabel?: string | null;
  currentIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  elapsedMs: number;
  playedMs: number;
  durationMs?: number;
  updatedAt: string;
};
