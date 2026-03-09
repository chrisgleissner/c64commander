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
/** Stack page start. */
const STACK_START = 0x0100;
/** Stack page end (inclusive). */
const STACK_END_INCLUSIVE = 0x01ff;
/** STREND pointer low byte address. */
const STREND_LO = 0x002b;
/** STREND pointer high byte address. */
const STREND_HI = 0x002c;
/** BASIC pointer region start. */
const BASIC_PTR_START = 0x002b;
/** BASIC pointer region end (inclusive). */
const BASIC_PTR_END = 0x0038;

/** Full 16 KiB VIC bank size. */
const VIC_BANK_SIZE = 0x4000;
/** VIC-II register block ($D000–$D02E). Controls all display parameters. */
const VIC_REG_START = 0xd000;
const VIC_REG_END_INCLUSIVE = 0xd02e;
/**
 * CIA2 Port A address. Bits 1:0 (inverted) select the VIC bank:
 *   VIC bank = (~value) & 0x03 → bank base = bank × $4000
 */
const CIA2_PA_ADDR = 0xdd00;
/**
 * CIA2 register block ($DD00–$DD0F). Saving Port A (bank select) and Port A DDR
 * is required to correctly restore the VIC bank configuration.
 */
const CIA2_REG_START = 0xdd00;
const CIA2_REG_END_INCLUSIVE = 0xdd0f;
/** Colour RAM (fixed CPU address, not banked). */
const COLOR_START = 0xd800;
const COLOR_END_INCLUSIVE = 0xdbff;

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

const toHex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/**
 * Computes the CPU start address of the active VIC bank from the underlying
 * DRAM image. Best-effort: valid when the DRAM value at $DD00 reflects the
 * active CIA2 register state (reliable for KERNAL/BASIC sessions).
 *
 * VIC bank = (~CIA2_PA) & 0x03 → bank base = bank × $4000
 *
 * Exported for unit-testing in isolation.
 */
export const computeVicBankStart = (fullImage: Uint8Array): number => {
  const cia2Pa = fullImage[CIA2_PA_ADDR];
  const vicBank = ~cia2Pa & 0x03;
  return vicBank * 0x4000;
};

/** Derives screen snapshot ranges from the full RAM image. */
const screenRanges = (fullImage: Uint8Array): { ranges: MemoryRange[]; displayRanges: string[] } => {
  const bankStart = computeVicBankStart(fullImage);
  const ranges: MemoryRange[] = [
    { start: bankStart, length: VIC_BANK_SIZE },
    { start: VIC_REG_START, length: VIC_REG_END_INCLUSIVE - VIC_REG_START + 1 },
    { start: COLOR_START, length: COLOR_END_INCLUSIVE - COLOR_START + 1 },
    { start: CIA2_REG_START, length: CIA2_REG_END_INCLUSIVE - CIA2_REG_START + 1 },
  ];
  return {
    ranges,
    displayRanges: [
      "VICBANK",
      `${toHex(VIC_REG_START)}-${toHex(VIC_REG_END_INCLUSIVE)}`,
      `${toHex(COLOR_START)}-${toHex(COLOR_END_INCLUSIVE)}`,
      `${toHex(CIA2_REG_START)}-${toHex(CIA2_REG_END_INCLUSIVE)}`,
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

/** Derives ranges for the program snapshot (all RAM except the stack page). */
const programRanges = (): { ranges: MemoryRange[]; displayRanges: string[] } => ({
  ranges: [
    { start: 0x0000, length: STACK_START },
    { start: STACK_END_INCLUSIVE + 1, length: 0x10000 - (STACK_END_INCLUSIVE + 1) },
  ],
  displayRanges: ["$0000-$00FF", "$0200-$FFFF"],
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
  contentName?: string;
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
  const { type, customRanges, label, contentName } = options;

  const fullImage = await dumpFullRamImage(api);
  const now = new Date();

  let ranges: MemoryRange[];
  let displayRanges: string[];

  if (type === "program") {
    ({ ranges, displayRanges } = programRanges());
  } else if (type === "basic") {
    ({ ranges, displayRanges } = basicRanges(fullImage));
  } else if (type === "screen") {
    ({ ranges, displayRanges } = screenRanges(fullImage));
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
    ...(contentName?.trim() ? { content_name: contentName.trim() } : {}),
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
