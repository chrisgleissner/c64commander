/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCpuSnapshot, CpuSnapshotUnsupportedError } from "@/lib/snapshot/snapshotCreation";
import { decodeSnapshot } from "@/lib/snapshot/snapshotFormat";
import type { C64API } from "@/lib/c64api";
import type { CpuSnapshotData } from "@/lib/snapshot/cpu/cpuSnapshot";
import type { SnapshotCapability } from "@/lib/snapshot/cpu/capability";

// ---------------------------------------------------------------------------
// Mocks — the capture/restore engines + heavy REST client are exercised by
// their own suites; here we drive createCpuSnapshot's orchestration only.
// ---------------------------------------------------------------------------

const detectSnapshotCapabilityMock = vi.fn<() => Promise<SnapshotCapability>>();
const getCartridgeConfigMock = vi.fn();
const captureCpuSnapshotDataMock = vi.fn();
const dumpRamRangesMock = vi.fn(async () => ({ ranges: [], blocks: [new Uint8Array(0x10000)] }));
const saveSnapshotToStoreMock = vi.fn();

vi.mock("@/lib/buildInfo", () => ({
  getBuildInfo: () => ({ versionLabel: "9.9.9-test" }),
}));

vi.mock("@/lib/machine/ramOperations", () => ({
  dumpRamRanges: (...args: unknown[]) => dumpRamRangesMock(...(args as [])),
}));

vi.mock("@/lib/snapshot/cpu/capability", () => ({
  detectSnapshotCapability: (...args: unknown[]) => detectSnapshotCapabilityMock(...(args as [])),
  getCartridgeConfig: (...args: unknown[]) => getCartridgeConfigMock(...(args as [])),
}));

vi.mock("@/lib/snapshot/cpu/cpuSnapshot", async (importOriginal) => {
  // Keep the real buildCpuSnapshotMetadata (pure) so the encoded snapshot carries
  // honest v2 metadata; only the capture engine is stubbed.
  const actual = await importOriginal<typeof import("@/lib/snapshot/cpu/cpuSnapshot")>();
  return {
    ...actual,
    captureCpuSnapshotData: (...args: unknown[]) => captureCpuSnapshotDataMock(...(args as [])),
  };
});

vi.mock("@/lib/snapshot/snapshotStore", () => ({
  saveSnapshotToStore: (...args: unknown[]) => saveSnapshotToStoreMock(...args),
}));

const mockApi = {} as C64API;

const sampleData = (): CpuSnapshotData => ({
  ranges: [
    { start: 0x0000, length: 0x0100 },
    { start: 0x0100, length: 0x0100 },
    { start: 0x0200, length: 0xfe00 },
  ],
  blocks: [new Uint8Array(0x0100), new Uint8Array(0x0100), new Uint8Array(0xfe00)],
  cpu: { pc: 0xc000, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 },
  captureMethod: "rli",
});

beforeEach(() => {
  vi.clearAllMocks();
  getCartridgeConfigMock.mockResolvedValue({ was_active: false, ram_resident_assumed: true });
  dumpRamRangesMock.mockResolvedValue({ ranges: [], blocks: [new Uint8Array(0x10000)] });
  // Drive the real dumpFullRam closure that createCpuSnapshot passes in, so the
  // 64 KiB paused-read path is exercised (not just stubbed away).
  captureCpuSnapshotDataMock.mockImplementation(async (_api: unknown, dumpFullRam: () => Promise<Uint8Array>) => {
    const image = await dumpFullRam();
    expect(image.length).toBe(0x10000);
    return sampleData();
  });
  saveSnapshotToStoreMock.mockReturnValue(undefined);
});

describe("createCpuSnapshot", () => {
  it("captures, encodes an honest v2 snapshot, stores it, and returns the CPU summary", async () => {
    detectSnapshotCapabilityMock.mockResolvedValue({
      firmware: { product: "C64 Ultimate", firmware_version: "1.1.0" },
      cpuSnapshotSupported: true,
    });

    const result = await createCpuSnapshot(mockApi, { label: " Boss Fight ", contentName: " Boss Fight " });

    expect(result.cpu).toEqual({ pc: 0xc000, a: 0x11, x: 0x22, y: 0x33, sp: 0xf6, p: 0x30 });
    expect(result.captureMethod).toBe("rli");
    expect(result.displayTimestamp).toMatch(/\d{4}-\d{2}-\d{2}/);

    expect(saveSnapshotToStoreMock).toHaveBeenCalledOnce();
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.snapshotType).toBe("program");
    expect(saved.filename).toMatch(/\.c64snap$/);

    const decoded = decodeSnapshot(saved.bytes);
    expect(decoded.version).toBe(2);
    expect(decoded.hasCpuState).toBe(true);
    expect(decoded.metadata?.cpu_state_captured).toBe(true);
    expect(decoded.metadata?.app_version).toBe("9.9.9-test");
    expect(decoded.metadata?.label).toBe("Boss Fight");
    expect(decoded.metadata?.firmware?.firmware_version).toBe("1.1.0");
  });

  it("reads the cartridge config so it can be recorded in metadata", async () => {
    detectSnapshotCapabilityMock.mockResolvedValue({
      firmware: {},
      cpuSnapshotSupported: true,
    });
    getCartridgeConfigMock.mockResolvedValue({
      configured_name: "Action_Replay.crt",
      was_active: true,
      ram_resident_assumed: true,
    });

    await createCpuSnapshot(mockApi);

    expect(getCartridgeConfigMock).toHaveBeenCalledWith(mockApi);
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(decodeSnapshot(saved.bytes).metadata?.cartridge?.configured_name).toBe("Action_Replay.crt");
  });

  it("throws CpuSnapshotUnsupportedError (with the capability reason) when unsupported", async () => {
    detectSnapshotCapabilityMock.mockResolvedValue({
      firmware: {},
      cpuSnapshotSupported: false,
      reason: "/v1/info unavailable: HTTP 404",
    });

    await expect(createCpuSnapshot(mockApi)).rejects.toBeInstanceOf(CpuSnapshotUnsupportedError);
    await expect(createCpuSnapshot(mockApi)).rejects.toThrow(/404/);
    expect(captureCpuSnapshotDataMock).not.toHaveBeenCalled();
    expect(saveSnapshotToStoreMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the capability has no reason", async () => {
    detectSnapshotCapabilityMock.mockResolvedValue({
      firmware: {},
      cpuSnapshotSupported: false,
    });

    await expect(createCpuSnapshot(mockApi)).rejects.toThrow(/does not support CPU snapshots/);
  });
});
