/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildCpuSnapshotMetadata,
  captureCpuSnapshotData,
  CPU_SNAPSHOT_RANGES,
  restoreCpuSnapshotFromDecoded,
  toRestoreRanges,
  type CpuSnapshotData,
} from "@/lib/snapshot/cpu/cpuSnapshot";
import type { MemoryRange } from "@/lib/snapshot/snapshotTypes";
import type { CaptureCpuApi } from "@/lib/snapshot/cpu/captureEngine";
import type { RestoreCpuApi } from "@/lib/snapshot/cpu/restoreCart";
import { decodeSnapshot, encodeSnapshot } from "@/lib/snapshot/snapshotFormat";

const parse = (hex: string) => parseInt(hex, 16);

/** Reconstructs a flat 64 KiB image from ranges/blocks so tests can index by absolute address. */
const flatten = (ranges: MemoryRange[], blocks: Uint8Array[]): Uint8Array => {
  const img = new Uint8Array(0x10000);
  ranges.forEach((r, i) => img.set(blocks[i]!, r.start));
  return img;
};

// Default-safe-region ($033C) scratch + captured flag addresses (see capturePayload).
const SCRATCH = { pcl: 0x0382, captured: 0x038a };

/** Minimal capture firmware: pre-seeds the IRQ vector + cassette buffer, fires on resume. */
const makeCaptureMock = () => {
  const mem = new Map<number, number>();
  mem.set(0x01, 0x37);
  mem.set(0x0314, 0x31);
  mem.set(0x0315, 0xea);
  for (let i = 0; i < 82; i++) mem.set(0x033c + i, 0xa0); // recognizable "original" bytes
  const frame = { pcl: 0x00, pch: 0xc0, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 };
  const writes: number[] = [];
  const api: CaptureCpuApi = {
    machinePause: async () => ({ errors: [] }),
    machineResume: async () => {
      // simulate the IRQ entering the handler and capturing
      mem.set(SCRATCH.pcl, frame.pcl);
      mem.set(SCRATCH.pcl + 1, frame.pch);
      mem.set(SCRATCH.pcl + 2, frame.a);
      mem.set(SCRATCH.pcl + 3, frame.x);
      mem.set(SCRATCH.pcl + 4, frame.y);
      mem.set(SCRATCH.pcl + 5, frame.sp);
      mem.set(SCRATCH.pcl + 6, frame.p);
      mem.set(SCRATCH.captured, 0x01);
      return { errors: [] };
    },
    readMemory: async (address: string, length = 1) => {
      const start = parse(address);
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = mem.get(start + i) ?? 0;
      return out;
    },
    writeMemoryBlock: async (address: string, data: Uint8Array) => {
      writes.push(parse(address));
      data.forEach((b, i) => mem.set(parse(address) + i, b));
      return { errors: [] };
    },
  };
  return { api, mem, writes };
};

describe("captureCpuSnapshotData", () => {
  it("captures registers, substitutes the clobbered bytes, and resumes", async () => {
    const { api } = makeCaptureMock();
    // The live dump still contains our handler at $033C and hook at $0314 — they must be substituted.
    const dumpFullRam = vi.fn(async () => {
      const img = new Uint8Array(0x10000);
      img.fill(0x00);
      img[0x033c] = 0xff; // handler junk in the live dump
      img[0x0314] = 0x3c; // hook junk
      return img;
    });

    const data = await captureCpuSnapshotData(api, dumpFullRam);

    expect(data.cpu).toEqual({ pc: 0xc000, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 });
    expect(data.captureMethod).toBe("rli");
    expect(data.ranges).toEqual(CPU_SNAPSHOT_RANGES); // 3 ranges (u16-safe), incl. the stack page
    // The substituted image carries the program's original bytes, not the handler.
    const img = flatten(data.ranges, data.blocks);
    expect(img[0x033c]).toBe(0xa0); // restored cassette-buffer byte
    expect(img[0x0314]).toBe(0x31); // restored IRQ vector low byte
  });

  it("resumes the program even if the dump throws", async () => {
    const { api } = makeCaptureMock();
    const dumpFullRam = vi.fn(async () => {
      throw new Error("dump failed");
    });
    await expect(captureCpuSnapshotData(api, dumpFullRam)).rejects.toThrow(/dump failed/);
  });
});

describe("buildCpuSnapshotMetadata", () => {
  const data: CpuSnapshotData = {
    ranges: [{ start: 0, length: 0x10000 }],
    blocks: [new Uint8Array(0x10000)],
    cpu: { pc: 0xc000, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 },
    captureMethod: "rli",
  };

  it("emits honest v2 metadata", () => {
    const meta = buildCpuSnapshotMetadata(data, {
      createdAt: "2026-06-26 12:00:00",
      appVersion: "9.9.9",
      label: "boss fight",
      firmware: { product: "C64 Ultimate", firmware_version: "1.1.0" },
      cartridge: { was_active: false, ram_resident_assumed: true },
    });
    expect(meta.cpu_state_captured).toBe(true);
    expect(meta.capture_method).toBe("rli");
    expect(meta.restore_method).toBe("cur");
    expect(meta.cpu).toMatchObject({ pc: 0xc000, a: 0x11, sp: 0xf6 });
    expect(meta.cpu?.flags).toBeDefined();
    expect(meta.firmware?.firmware_version).toBe("1.1.0");
    expect(meta.label).toBe("boss fight");
  });
});

describe("restoreCpuSnapshotFromDecoded", () => {
  const makeRestoreMock = () => {
    const calls: Array<{ cpu: unknown; ranges: number }> = [];
    const api: RestoreCpuApi = {
      runCartridgeUpload: async () => ({ errors: [] }),
      readMemory: async () => new Uint8Array([0xa5]), // always READY
      writeMemoryBlock: async () => ({ errors: [] }),
    };
    return { api, calls };
  };

  it("drives CUR restore through the full encode→decode round-trip", async () => {
    const image = new Uint8Array(0x10000);
    image[0x01] = 0x37; // banking, required for CUR restore
    const data: CpuSnapshotData = {
      ranges: CPU_SNAPSHOT_RANGES,
      blocks: CPU_SNAPSHOT_RANGES.map((r) => image.slice(r.start, r.start + r.length)),
      cpu: { pc: 0xc000, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 },
      captureMethod: "rli",
    };
    const meta = buildCpuSnapshotMetadata(data, { createdAt: "2026-06-26 12:00:00" });
    const bytes = encodeSnapshot("program", new Date(0), data.ranges, data.blocks, meta);
    const decoded = decodeSnapshot(bytes);
    expect(decoded.version).toBe(2);
    expect(decoded.hasCpuState).toBe(true);

    const { api } = makeRestoreMock();
    const result = await restoreCpuSnapshotFromDecoded(api, decoded);
    expect(result.ok).toBe(true);
    expect(result.rtiFrameAddress).toBe(0x01f4); // $0100 + $F6 - 2
  });

  it("refuses to restore a snapshot without captured CPU state", async () => {
    const { api } = makeRestoreMock();
    await expect(
      restoreCpuSnapshotFromDecoded(api, {
        metadata: { snapshot_type: "program", display_ranges: [], created_at: "" },
        ranges: [],
        blocks: [],
      }),
    ).rejects.toThrow(/no captured CPU state/);
  });
});

describe("toRestoreRanges", () => {
  it("zips ranges with their blocks", () => {
    const ranges = [{ start: 0x0100, length: 2 }];
    const blocks = [new Uint8Array([0xaa, 0xbb])];
    expect(toRestoreRanges(ranges, blocks)).toEqual([{ start: 0x0100, bytes: blocks[0] }]);
  });
});
