/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { getBuildInfo } from "@/lib/buildInfo";
import { dumpRamRanges } from "@/lib/machine/ramOperations";
import { encodeSnapshot } from "./snapshotFormat";
import { buildSnapshotFileName, formatDisplayTimestamp } from "./snapshotFilename";
import { saveSnapshotToStore } from "./snapshotStore";
import type { MemoryRange, SnapshotMetadata, SnapshotType } from "./snapshotTypes";
import { detectSnapshotCapability, getCartridgeConfig } from "./cpu/capability";
import { buildCpuSnapshotMetadata, captureCpuSnapshotData } from "./cpu/cpuSnapshot";
import type { CpuState } from "./cpu/cpuState";

// ---------------------------------------------------------------------------
// Address constants
// ---------------------------------------------------------------------------

/** BASIC program start (hardcoded). */
const BASIC_START = 0x0801;
/** Stack page start. */
const STACK_START = 0x0100;
/** Stack page end (inclusive). */
const STACK_END_INCLUSIVE = 0x01ff;
/** BASIC pointer region start. */
const BASIC_PTR_START = 0x002b;
/** BASIC pointer region end (inclusive). */
const BASIC_PTR_END = 0x0038;
/** Fixed BASIC snapshot end requested for Home quick snapshots. */
const BASIC_SNAPSHOT_END_INCLUSIVE = 0x9fff;

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
/** CIA2 Port A and DDR only. Avoid timer/interrupt registers that affect cursor timing. */
const CIA2_REG_START = 0xdd00;
const CIA2_REG_END_INCLUSIVE = 0xdd01;
/** Colour RAM (fixed CPU address, not banked). */
const COLOR_START = 0xd800;
const COLOR_END_INCLUSIVE = 0xdbff;

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

const toHex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/**
 * Computes the CPU start address of the active VIC bank from the live CIA2
 * Port A register ($DD00).
 *
 * VIC bank = (~CIA2_PA) & 0x03 → bank base = bank × $4000
 *
 * Exported for unit-testing in isolation.
 */
export const computeVicBankStart = (cia2Pa: number): number => {
  const vicBank = ~cia2Pa & 0x03;
  return vicBank * 0x4000;
};

/** Derives screen snapshot ranges from the live CIA2 Port A ($DD00) value. */
const screenRanges = (cia2Pa: number): { ranges: MemoryRange[]; displayRanges: string[] } => {
  const bankStart = computeVicBankStart(cia2Pa);
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

/** Derives fixed BASIC snapshot ranges. */
const basicRanges = (): { ranges: MemoryRange[]; displayRanges: string[] } => {
  const basicLength = BASIC_SNAPSHOT_END_INCLUSIVE - BASIC_START + 1;
  const ptrLength = BASIC_PTR_END - BASIC_PTR_START + 1;
  const ranges: MemoryRange[] = [
    { start: BASIC_PTR_START, length: ptrLength },
    { start: BASIC_START, length: basicLength },
  ];
  return {
    ranges,
    displayRanges: [
      `${toHex(BASIC_PTR_START)}-${toHex(BASIC_PTR_END)}`,
      `${toHex(BASIC_START)}-${toHex(BASIC_SNAPSHOT_END_INCLUSIVE)}`,
    ],
  };
};

/**
 * Derives ranges for the program snapshot: everything except the stack page
 * ($0100-$01FF). This includes the full I/O region so the VIC-II registers,
 * SID, colour RAM and both CIA chips (notably CIA2 $DD00, which selects the VIC
 * bank) are captured. The restore path skips only the CIA timer registers
 * ($xx04-$xx07) so they cannot reprogram the jiffy IRQ; everything else,
 * including the VIC-bank mapping, is restored faithfully.
 */
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

  if (type === "custom" && (!customRanges || customRanges.length === 0)) {
    throw new Error("Custom snapshot requires at least one memory range.");
  }

  const now = new Date();

  // Read only the ranges this snapshot type actually needs — no full 64 KiB
  // dump. A screen snapshot reads the live CIA2 VIC-bank register ($DD00) first,
  // inside the same paused session, to decide which 16 KiB bank to capture.
  let displayRanges: string[] = [];
  const { ranges, blocks } = await dumpRamRanges(api, async (read) => {
    let resolved: { ranges: MemoryRange[]; displayRanges: string[] };
    if (type === "program") {
      resolved = programRanges();
    } else if (type === "basic") {
      resolved = basicRanges();
    } else if (type === "screen") {
      const cia2Pa = (await read(CIA2_PA_ADDR, 1))[0];
      resolved = screenRanges(cia2Pa);
    } else {
      const ranges = customRanges as MemoryRange[];
      resolved = { ranges, displayRanges: ranges.map((r) => `${toHex(r.start)}-${toHex(r.start + r.length - 1)}`) };
    }
    displayRanges = resolved.displayRanges;
    return resolved.ranges;
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

/** Thrown when the connected device cannot support CPU-state snapshots. */
export class CpuSnapshotUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CpuSnapshotUnsupportedError";
  }
}

/**
 * Captures a CPU+RAM snapshot: rides the live interrupt to capture the 6510
 * registers (freezing the program), DMA-reads the full 64 KiB image, restores
 * the bytes the capture clobbered, writes an honest v2 `.c64snap`, then resumes
 * the program transparently. Throws {@link CpuSnapshotUnsupportedError} when the
 * firmware can't support it (the caller should offer a RAM-only snapshot).
 */
export const createCpuSnapshot = async (
  api: C64API,
  options: { label?: string; contentName?: string } = {},
): Promise<{ displayTimestamp: string; cpu: CpuState; captureMethod: "rli" | "isn" }> => {
  const capability = await detectSnapshotCapability(api);
  if (!capability.cpuSnapshotSupported) {
    throw new CpuSnapshotUnsupportedError(capability.reason ?? "this device does not support CPU snapshots");
  }
  const cartridge = await getCartridgeConfig(api);

  // Full 64 KiB read, executed (paused) inside captureCpuSnapshotData after the
  // capture has frozen the program.
  const dumpFullRam = async () => {
    const { blocks } = await dumpRamRanges(api, [{ start: 0x0000, length: 0x10000 }]);
    return blocks[0]!;
  };

  const data = await captureCpuSnapshotData(api, dumpFullRam);

  const now = new Date();
  const displayTimestamp = formatDisplayTimestamp(now);
  const metadata = buildCpuSnapshotMetadata(data, {
    createdAt: displayTimestamp,
    appVersion: getBuildInfo().versionLabel,
    label: options.label,
    contentName: options.contentName,
    firmware: capability.firmware,
    cartridge,
  });

  const bytes = encodeSnapshot("program", now, data.ranges, data.blocks, metadata);
  saveSnapshotToStore({
    id: generateId(),
    filename: buildSnapshotFileName("program", now),
    bytes,
    createdAt: now.toISOString(),
    snapshotType: "program",
    metadata,
  });

  return { displayTimestamp, cpu: data.cpu, captureMethod: data.captureMethod };
};
