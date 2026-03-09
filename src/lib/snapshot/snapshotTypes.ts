/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type SnapshotType = "program" | "basic" | "screen" | "custom";

/** Binary type code stored in .c64snap header. */
export const SNAPSHOT_TYPE_CODES: Record<SnapshotType, number> = {
  program: 0,
  basic: 1,
  screen: 2,
  custom: 3,
};

/** Reverse map from binary code to SnapshotType. */
export const SNAPSHOT_TYPE_FROM_CODE: Record<number, SnapshotType> = {
  0: "program",
  1: "basic",
  2: "screen",
  3: "custom",
};

/** A single contiguous memory region saved in a snapshot. */
export type MemoryRange = {
  /** Inclusive start address (0x0000–0xFFFF). */
  start: number;
  /** Byte count (1–65536). */
  length: number;
};

/** Optional JSON metadata stored at the tail of a .c64snap file. */
export type SnapshotMetadata = {
  label?: string;
  content_name?: string;
  content_type?: "game" | "song" | "program" | "other";
  name_source?: "app_launch" | "user" | "imported" | "unknown";
  snapshot_type: SnapshotType;
  /** Human-readable range strings, e.g. "$0000-$FFFF". */
  display_ranges: string[];
  /** "YYYY-MM-DD HH:MM:SS" */
  created_at: string;
  app_version?: string;
};

/** Full in-memory representation of a snapshot. */
export type SnapshotRecord = {
  id: string;
  filename: string;
  /** Raw .c64snap binary bytes. */
  bytes: Uint8Array;
  /** ISO 8601 creation date for sorting. */
  createdAt: string;
  snapshotType: SnapshotType;
  metadata: SnapshotMetadata;
};

/** localStorage-serialisable representation (bytes as base64). */
export type SnapshotStorageEntry = {
  id: string;
  filename: string;
  bytesBase64: string;
  createdAt: string;
  snapshotType: SnapshotType;
  metadata: SnapshotMetadata;
};

/** Per-type UI display configuration. */
export type SnapshotTypeConfig = {
  type: SnapshotType;
  /** Label shown in Save RAM dialog. */
  label: string;
  /** Range expression shown in UI, e.g. "$0000–$FFFF". */
  rangeDisplay: string;
  /** File name prefix segment. */
  filePrefix: string;
};

export const SNAPSHOT_TYPE_LIST: SnapshotTypeConfig[] = [
  {
    type: "program",
    label: "Program Snapshot",
    rangeDisplay: "$0000–$00FF, $0200–$FFFF",
    filePrefix: "program",
  },
  {
    type: "basic",
    label: "Basic Snapshot",
    rangeDisplay: "$002B–$0038, $0801–STREND",
    filePrefix: "basic",
  },
  {
    type: "screen",
    label: "Screen Snapshot",
    rangeDisplay: "SCRRAM, $D000–$D02E, $D800–$DBFF, $DD00–$DD0F",
    filePrefix: "screen",
  },
  {
    type: "custom",
    label: "Custom…",
    rangeDisplay: "User-defined",
    filePrefix: "custom",
  },
];

/** Maximum number of snapshots retained in the store. */
export const MAX_SNAPSHOTS = 100;
