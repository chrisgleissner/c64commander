/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ConfigFileReference } from "@/lib/config/configFileReference";
import type { ConfigResolutionOrigin, ConfigValueOverride } from "@/lib/config/playbackConfig";
import type { ArchivePlaylistReference } from "@/lib/archive/types";

export type SourceKind = "local" | "ultimate" | "hvsc" | "commoserve";

export type TrackRecord = {
  trackId: string;
  sourceKind: SourceKind;
  sourceLocator: string;
  sourceId?: string | null;
  category?: string | null;
  title: string;
  author?: string | null;
  released?: string | null;
  path: string;
  configRef?: ConfigFileReference | null;
  archiveRef?: ArchivePlaylistReference | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  defaultDurationMs?: number | null;
  subsongCount?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PlaylistItemRecord = {
  playlistItemId: string;
  playlistId: string;
  trackId: string;
  configRef?: ConfigFileReference | null;
  configOrigin?: ConfigResolutionOrigin | null;
  configOverrides?: ConfigValueOverride[] | null;
  songNr: number;
  sortKey: string;
  durationOverrideMs?: number | null;
  status: "ready" | "unavailable";
  unavailableReason?: "source-revoked" | "file-inaccessible" | "hvsc-unavailable" | null;
  addedAt: string;
};

export type PlaylistSessionRecord = {
  playlistId: string;
  currentPlaylistItemId: string | null;
  isPlaying: boolean;
  isPaused: boolean;
  elapsedMs: number;
  playedMs: number;
  shuffleEnabled: boolean;
  repeatEnabled: boolean;
  randomSeed?: number | null;
  randomCursor?: number | null;
  activeQuery?: string | null;
  updatedAt: string;
};

export type PlaylistQuerySort = "playlist-position" | "title" | "path";

export type PlaylistQueryOptions = {
  playlistId: string;
  query?: string;
  categoryFilter?: string[];
  limit: number;
  offset: number;
  sort?: PlaylistQuerySort;
};

export type PlaylistQueryRow = {
  playlistItem: PlaylistItemRecord;
  track: TrackRecord;
};

export type PlaylistQueryResult = {
  rows: PlaylistQueryRow[];
  totalMatchCount: number;
};

export type RandomPlaySession = {
  playlistId: string;
  seed: number;
  cursor: number;
  order: string[];
};
