/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { getBuildInfo } from "@/lib/buildInfo";
import { dumpFullRamImage } from "@/lib/machine/ramOperations";
import { encodeSnapshot } from "./snapshotFormat";
import { buildSnapshotFileName, formatDisplayTimestamp } from "./snapshotFilename";
import { saveSnapshotToStore } from "./snapshotStore";
import type { MemoryRange, SnapshotMetadata, SnapshotType } from "./snapshotTypes";

// ---------------------------------------------------------------------------
// Address constants
// ---------------------------------------------------------------------------

/** BASIC program start (hardcoded). */
const BASIC_START = 0x0801;
/** STREND pointer low byte address. */
const STREND_LO = 0x002b;
/** STREND pointer high byte address. */
const STREND_HI = 0x002c;
/** BASIC pointer region start. */
const BASIC_PTR_START = 0x002b;
/** BASIC pointer region end (inclusive). */
const BASIC_PTR_END = 0x0038;

/** Screen character memory. */
const SCREEN_START = 0x0400;
const SCREEN_END_INCLUSIVE = 0x07e7;
/** Colour RAM. */
const COLOR_START = 0xd800;
const COLOR_END_INCLUSIVE = 0xdbff;

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

const toHex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/** Derives the fixed screen snapshot ranges. */
const screenRanges = (): { ranges: MemoryRange[]; displayRanges: string[] } => {
  const ranges: MemoryRange[] = [
    { start: SCREEN_START, length: SCREEN_END_INCLUSIVE - SCREEN_START + 1 },
    { start: COLOR_START, length: COLOR_END_INCLUSIVE - COLOR_START + 1 },
  ];
  return {
    ranges,
    displayRanges: [
      `${toHex(SCREEN_START)}-${toHex(SCREEN_END_INCLUSIVE)}`,
      `${toHex(COLOR_START)}-${toHex(COLOR_END_INCLUSIVE)}`,
    ],
  };
};

/** Derives BASIC snapshot ranges, reading STREND from the full RAM image. */
const basicRanges = (fullImage: Uint8Array): { ranges: MemoryRange[]; displayRanges: string[] } => {
  const strend = fullImage[STREND_LO] | (fullImage[STREND_HI] << 8);
  const basicLength = Math.max(0, strend - BASIC_START);
  const ptrLength = BASIC_PTR_END - BASIC_PTR_START + 1;
  const ranges: MemoryRange[] = [
    { start: BASIC_START, length: basicLength },
    { start: BASIC_PTR_START, length: ptrLength },
  ];
  return {
    ranges,
    displayRanges: [`${toHex(BASIC_START)}-STREND`, `${toHex(BASIC_PTR_START)}-${toHex(BASIC_PTR_END)}`],
  };
};

/** Derives ranges for the full snapshot (all 64 KB). */
const fullRanges = (): { ranges: MemoryRange[]; displayRanges: string[] } => ({
  ranges: [{ start: 0x0000, length: 0x10000 }],
  displayRanges: ["$0000-$FFFF"],
});

/** Builds a unique snapshot ID from the current time. */
const generateId = () => {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `snap-${now}-${rand}`;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CreateSnapshotOptions = {
  type: SnapshotType;
  /** Required for custom snapshots. */
  customRanges?: MemoryRange[];
  label?: string;
};

/**
 * Dumps RAM, extracts the requested ranges, encodes a .c64snap blob, and
 * persists it to the snapshot store.
 *
 * Returns the display timestamp string so callers can show a confirmation.
 */
export const createSnapshot = async (
  api: C64API,
  options: CreateSnapshotOptions,
): Promise<{ displayTimestamp: string }> => {
  const { type, customRanges, label } = options;

  const fullImage = await dumpFullRamImage(api);
  const now = new Date();

  let ranges: MemoryRange[];
  let displayRanges: string[];

  if (type === "full") {
    ({ ranges, displayRanges } = fullRanges());
  } else if (type === "basic") {
    ({ ranges, displayRanges } = basicRanges(fullImage));
  } else if (type === "screen") {
    ({ ranges, displayRanges } = screenRanges());
  } else {
    // custom
    if (!customRanges || customRanges.length === 0) {
      throw new Error("Custom snapshot requires at least one memory range.");
    }
    ranges = customRanges;
    displayRanges = customRanges.map((r) => `${toHex(r.start)}-${toHex(r.start + r.length - 1)}`);
  }

  // Extract the byte blocks for each range from the full RAM image
  const blocks = ranges.map((r) => {
    const end = Math.min(r.start + r.length, fullImage.length);
    return fullImage.slice(r.start, end);
  });

  const displayTimestamp = formatDisplayTimestamp(now);

  const metadata: SnapshotMetadata = {
    snapshot_type: type,
    display_ranges: displayRanges,
    created_at: displayTimestamp,
    app_version: getBuildInfo().versionLabel,
    ...(label?.trim() ? { label: label.trim() } : {}),
  };

  const bytes = encodeSnapshot(type, now, ranges, blocks, metadata);
  const filename = buildSnapshotFileName(type, now);
  const id = generateId();

  saveSnapshotToStore({
    id,
    filename,
    bytes,
    createdAt: now.toISOString(),
    snapshotType: type,
    metadata,
  });

  return { displayTimestamp };
};
