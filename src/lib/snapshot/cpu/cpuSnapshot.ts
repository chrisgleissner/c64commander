/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { CpuState } from "./cpuState";
import { toCpuStateMeta } from "./cpuState";
import { captureCpuState, resumeAfterCapture, type CaptureCpuApi, type CaptureOverlay } from "./captureEngine";
import { restoreCpuSnapshot, type CpuRestoreRange, type RestoreCpuApi } from "./restoreCart";
import { addErrorLog } from "@/lib/logging";
import type { CartridgeMeta, FirmwareCapability, MemoryRange, SnapshotMetadata } from "../snapshotTypes";

/**
 * Integration layer that joins the capture/restore engines to the `.c64snap` v2
 * format. A CPU+RAM snapshot captures the live 6510 registers (RLI), DMA-reads
 * the full 64 KiB image, substitutes back the bytes the capture clobbered, and
 * builds honest v2 metadata. Restore decodes that metadata and drives CUR.
 */

/** A full CPU+RAM snapshot ready to encode/store: the 64 KiB image plus its metadata blocks. */
export type CpuSnapshotData = {
  ranges: MemoryRange[];
  blocks: Uint8Array[];
  cpu: CpuState;
  captureMethod: "rli" | "isn";
};

/** Reads the full 64 KiB image (paused) — injected so this module stays unit-testable. */
export type RamDumper = () => Promise<Uint8Array>;

/**
 * The full 64 KiB image as three ranges. A single $10000-length range would
 * overflow the format's u16 length field, so the image is split — and the split
 * deliberately isolates the stack page ($0100-$01FF), which a CPU snapshot must
 * include (unlike the RAM-only "program" type, which omits it).
 */
export const CPU_SNAPSHOT_RANGES: MemoryRange[] = [
  { start: 0x0000, length: 0x0100 }, // zero page + $01
  { start: 0x0100, length: 0x0100 }, // full stack page
  { start: 0x0200, length: 0xfe00 }, // everything else, incl. I/O (restore skips CIA timers)
];

/** Overlays a region's original bytes back into the full-image block (in place). */
const applyOverlay = (image: Uint8Array, overlay: CaptureOverlay) => {
  image.set(overlay.bytes, overlay.start);
};

/** Slices the full 64 KiB image into the snapshot's ranges/blocks. */
const sliceImage = (image: Uint8Array): { ranges: MemoryRange[]; blocks: Uint8Array[] } => ({
  ranges: CPU_SNAPSHOT_RANGES,
  blocks: CPU_SNAPSHOT_RANGES.map((r) => image.slice(r.start, r.start + r.length)),
});

/**
 * Captures CPU + full-RAM state into snapshot-ready data. The caller supplies a
 * paused 64 KiB RAM read (`dumpFullRam`); this function captures the registers
 * first (freezing the program), substitutes the clobbered capture bytes back
 * into the image so it reflects the program's true RAM, and resumes the program.
 */
export const captureCpuSnapshotData = async (api: CaptureCpuApi, dumpFullRam: RamDumper): Promise<CpuSnapshotData> => {
  const capture = await captureCpuState(api);
  try {
    const image = await dumpFullRam();
    if (image.length !== 0x10000) {
      throw new Error(`captureCpuSnapshotData: expected a 64 KiB image, got ${image.length} bytes`);
    }
    // Substitute the program's original bytes for everything the capture touched
    // (the safe region + the hooked IRQ vector), so the stored RAM is the
    // program's, not our handler's.
    for (const overlay of capture.overlays) applyOverlay(image, overlay);

    return {
      ...sliceImage(image),
      cpu: capture.cpu,
      captureMethod: capture.method,
    };
  } finally {
    // Always try to resume the program transparently, even if the dump failed.
    // A failure here can leave the C64 frozen with the IRQ vector repointed at
    // our handler, so it must be surfaced (not swallowed) so the UI can offer a
    // manual recovery path (Restore / power-cycle).
    await resumeAfterCapture(api, capture).catch((error) => {
      addErrorLog("Failed to resume program after CPU snapshot capture", {
        error: (error as Error).message,
        method: capture.method,
        vectorAddr: capture.vectorAddr,
      });
    });
  }
};

/** Builds v2 snapshot metadata for a captured CPU snapshot. */
export const buildCpuSnapshotMetadata = (
  data: CpuSnapshotData,
  context: {
    createdAt: string;
    appVersion?: string;
    label?: string;
    contentName?: string;
    firmware?: FirmwareCapability;
    cartridge?: CartridgeMeta;
  },
): SnapshotMetadata => ({
  snapshot_type: "program",
  display_ranges: ["$0000-$FFFF"],
  created_at: context.createdAt,
  ...(context.appVersion ? { app_version: context.appVersion } : {}),
  ...(context.label?.trim() ? { label: context.label.trim() } : {}),
  ...(context.contentName?.trim() ? { content_name: context.contentName.trim() } : {}),
  cpu: toCpuStateMeta(data.cpu),
  cpu_state_captured: true,
  capture_method: data.captureMethod,
  restore_method: "cur",
  ...(context.firmware ? { firmware: context.firmware } : {}),
  ...(context.cartridge ? { cartridge: context.cartridge } : {}),
});

/** Converts decoded snapshot ranges/blocks into the restore engine's range shape. */
export const toRestoreRanges = (ranges: MemoryRange[], blocks: Uint8Array[]): CpuRestoreRange[] =>
  ranges.map((r, i) => ({ start: r.start, bytes: blocks[i]! }));

/**
 * Restores a decoded CPU snapshot. Requires the metadata to carry a captured CPU
 * block (`cpu_state_captured`); the caller should gate on that before offering a
 * CPU resume (otherwise fall back to the RAM-only restore path).
 */
export const restoreCpuSnapshotFromDecoded = async (
  api: RestoreCpuApi,
  decoded: { metadata: SnapshotMetadata | null; ranges: MemoryRange[]; blocks: Uint8Array[] },
) => {
  const meta = decoded.metadata;
  if (!meta?.cpu || !meta.cpu_state_captured) {
    throw new Error("restoreCpuSnapshotFromDecoded: snapshot has no captured CPU state");
  }
  const cpu: CpuState = {
    pc: meta.cpu.pc,
    a: meta.cpu.a,
    x: meta.cpu.x,
    y: meta.cpu.y,
    sp: meta.cpu.sp,
    p: meta.cpu.p,
  };
  return restoreCpuSnapshot(api, { cpu, ramRanges: toRestoreRanges(decoded.ranges, decoded.blocks) });
};
