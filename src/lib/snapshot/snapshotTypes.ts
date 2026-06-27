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

// ---------------------------------------------------------------------------
// CPU-state (format v2) metadata blocks
// ---------------------------------------------------------------------------

/** Decoded 6502 processor-status (P) flags. The unused bit 5 is omitted. */
export type CpuFlags = {
  /** bit 7 — negative */
  n: boolean;
  /** bit 6 — overflow */
  v: boolean;
  /** bit 4 — break */
  b: boolean;
  /** bit 3 — decimal */
  d: boolean;
  /** bit 2 — interrupt disable */
  i: boolean;
  /** bit 1 — zero */
  z: boolean;
  /** bit 0 — carry */
  c: boolean;
};

/**
 * The captured 6510 CPU state stored in v2 snapshot metadata.
 * `p` is the raw status byte; `flags` is the decoded boolean map for readability.
 */
export type CpuStateMeta = {
  /** Program counter (0x0000–0xFFFF). */
  pc: number;
  /** Accumulator (0x00–0xFF). */
  a: number;
  /** X index (0x00–0xFF). */
  x: number;
  /** Y index (0x00–0xFF). */
  y: number;
  /** Stack pointer (0x00–0xFF; effective address $0100+sp). */
  sp: number;
  /** Raw processor-status byte (N V - B D I Z C). */
  p: number;
  /** Decoded view of `p`. */
  flags: CpuFlags;
};

/** How the CPU state was captured. `none` = RAM-only snapshot. */
export type CaptureMethod = "rli" | "isn" | "none";

/** How the CPU state is restored. Only the uploaded-cartridge path exists today. */
export type RestoreMethod = "cur";

/** Firmware/capability fingerprint recorded with a snapshot (from /v1/info + /v1/version). */
export type FirmwareCapability = {
  product?: string;
  firmware_version?: string;
  fpga_version?: string;
  core_version?: string;
  api_version?: string;
};

/** Cartridge context recorded with a snapshot. */
export type CartridgeMeta = {
  /** Configured cartridge file name at capture time, if any. */
  configured_name?: string;
  /** Whether a cartridge appeared to be the running context (best-effort). */
  was_active: boolean;
  /** CPU snapshots are only valid for RAM-resident programs; always true when set. */
  ram_resident_assumed: boolean;
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

  // --- v2 (CPU-state) optional blocks. Absent on RAM-only (v1) snapshots. ---
  /** Captured 6510 CPU state. Present iff this is a CPU+RAM (v2) snapshot. */
  cpu?: CpuStateMeta;
  /** Honest flag: true only when CPU state was actually captured and verified. */
  cpu_state_captured?: boolean;
  /** Capture mechanism used (rli/isn), or "none" for RAM-only. */
  capture_method?: CaptureMethod;
  /** Restore mechanism (always "cur" for CPU snapshots). */
  restore_method?: RestoreMethod;
  /** Firmware/capability fingerprint at capture time. */
  firmware?: FirmwareCapability;
  /** Cartridge context at capture time. */
  cartridge?: CartridgeMeta;
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
    rangeDisplay: "$002B–$0038, $0801–$9FFF",
    filePrefix: "basic",
  },
  {
    type: "screen",
    label: "Screen Snapshot",
    rangeDisplay: "VICBANK, $D000–$D02E, $D800–$DBFF, $DD00–$DD01",
    filePrefix: "screen",
  },
  {
    type: "custom",
    label: "Custom Snapshot",
    rangeDisplay: "User-defined",
    filePrefix: "custom",
  },
];

/** Maximum number of snapshots retained in the store. */
export const MAX_SNAPSHOTS = 100;
