/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeVicBankStart, createSnapshot } from "./snapshotCreation";
import { decodeSnapshot } from "./snapshotFormat";
import type { C64API } from "@/lib/c64api";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dumpFullRamImageMock = vi.fn();
const saveSnapshotToStoreMock = vi.fn();

vi.mock("@/lib/buildInfo", () => ({
  getBuildInfo: () => ({ versionLabel: "1.0.0-test" }),
}));

vi.mock("@/lib/machine/ramOperations", () => ({
  dumpFullRamImage: (...args: unknown[]) => dumpFullRamImageMock(...args),
  FULL_RAM_SIZE_BYTES: 65536,
}));

vi.mock("./snapshotStore", () => ({
  saveSnapshotToStore: (...args: unknown[]) => saveSnapshotToStoreMock(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a 64 KB RAM image with STREND set at $1000. */
const buildRam = (strend = 0x1000): Uint8Array => {
  const ram = new Uint8Array(65536);
  ram[0x002b] = strend & 0xff; // STREND low byte
  ram[0x002c] = (strend >> 8) & 0xff; // STREND high byte
  return ram;
};

const mockApi = {} as C64API;

beforeEach(() => {
  vi.clearAllMocks();
  dumpFullRamImageMock.mockResolvedValue(buildRam());
  saveSnapshotToStoreMock.mockReturnValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSnapshot – program", () => {
  it("resolves with a display timestamp", async () => {
    const result = await createSnapshot(mockApi, { type: "program" });
    expect(result.displayTimestamp).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("calls saveSnapshotToStore with program type and stack-safe ranges", async () => {
    await createSnapshot(mockApi, { type: "program" });
    expect(saveSnapshotToStoreMock).toHaveBeenCalledOnce();
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.snapshotType).toBe("program");
    expect(saved.metadata.display_ranges).toEqual(["$0000-$00FF", "$0200-$FFFF"]);
  });

  it("includes app_version from build info", async () => {
    await createSnapshot(mockApi, { type: "program" });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.metadata.app_version).toBe("1.0.0-test");
  });

  it("includes trimmed label in metadata when provided", async () => {
    await createSnapshot(mockApi, { type: "program", label: "  Before game  " });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.metadata.label).toBe("Before game");
  });

  it("omits label from metadata when label is blank", async () => {
    await createSnapshot(mockApi, { type: "program", label: "   " });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.metadata.label).toBeUndefined();
  });

  it("omits label from metadata when no label given", async () => {
    await createSnapshot(mockApi, { type: "program" });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.metadata.label).toBeUndefined();
  });

  it("includes trimmed content_name in metadata when provided", async () => {
    await createSnapshot(mockApi, { type: "program", contentName: "  Last Ninja.d64  " });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.metadata.content_name).toBe("Last Ninja.d64");
  });
});

describe("createSnapshot – basic", () => {
  it("resolves with a display timestamp", async () => {
    const result = await createSnapshot(mockApi, { type: "basic" });
    expect(result.displayTimestamp).toBeDefined();
  });

  it("uses STREND from RAM image to determine BASIC end", async () => {
    dumpFullRamImageMock.mockResolvedValue(buildRam(0x1234));
    await createSnapshot(mockApi, { type: "basic" });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.snapshotType).toBe("basic");
    // display_ranges[0] covers $0801 to STREND
    expect(saved.metadata.display_ranges[0]).toContain("$0801");
  });

  it("handles STREND equal to BASIC_START (zero-length program)", async () => {
    // STREND at $0801 => basicLength = 0
    dumpFullRamImageMock.mockResolvedValue(buildRam(0x0801));
    await createSnapshot(mockApi, { type: "basic" });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.snapshotType).toBe("basic");
  });
});

describe("createSnapshot – screen", () => {
  /** Build a RAM image with KERNAL-default CIA2/VIC values: bank 0, screen at $0400. */
  const buildRamWithDefaultVic = (strend = 0x1000): Uint8Array => {
    const ram = buildRam(strend);
    // CIA2 Port A $3F → bits 1:0 = 11 → (~0x3F) & 0x03 = 0 → bank 0
    ram[0xdd00] = 0x3f;
    // VIC $D018 = 0x15 → VM13-VM10 = 0001 → screen offset = 1 × $0400 = $0400
    ram[0xd018] = 0x15;
    return ram;
  };

  beforeEach(() => {
    dumpFullRamImageMock.mockResolvedValue(buildRamWithDefaultVic());
  });

  it("resolves with a display timestamp", async () => {
    const result = await createSnapshot(mockApi, { type: "screen" });
    expect(result.displayTimestamp).toBeDefined();
  });

  it("saves four ranges: VICBANK, VIC registers, colour RAM, and CIA2", async () => {
    await createSnapshot(mockApi, { type: "screen" });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.snapshotType).toBe("screen");
    expect(saved.metadata.display_ranges).toHaveLength(4);
    expect(saved.metadata.display_ranges[0]).toBe("VICBANK");
    expect(saved.metadata.display_ranges[1]).toMatch(/\$D000/);
    expect(saved.metadata.display_ranges[2]).toMatch(/\$D800/);
    expect(saved.metadata.display_ranges[3]).toMatch(/\$DD00/);
  });

  it("encodes VICBANK range as full 16 KiB starting at bank base", async () => {
    await createSnapshot(mockApi, { type: "screen" });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    const decoded = decodeSnapshot(saved.bytes);
    // First range = VICBANK: bank 0 base ($0000), length $4000
    expect(decoded.ranges[0].start).toBe(0x0000);
    expect(decoded.ranges[0].length).toBe(0x4000);
  });

  it("tracks CIA2 bank selection: bank 1 ($DD00=0xFE) starts VICBANK at $4000", async () => {
    const ram = buildRam();
    ram[0xdd00] = 0xfe; // bank 1
    dumpFullRamImageMock.mockResolvedValue(ram);
    await createSnapshot(mockApi, { type: "screen" });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    const decoded = decodeSnapshot(saved.bytes);
    expect(decoded.ranges[0].start).toBe(0x4000);
    expect(decoded.ranges[0].length).toBe(0x4000);
  });
});

describe("computeVicBankStart – VIC bank calculation", () => {
  it("bank 0 with KERNAL default ($DD00=0x3F) → bank base $0000", () => {
    const ram = new Uint8Array(65536);
    ram[0xdd00] = 0x3f; // (~0x3F) & 0x03 = 0 → bank 0
    expect(computeVicBankStart(ram)).toBe(0x0000);
  });

  it("bank 1 ($DD00=0xFE) → bank base $4000", () => {
    const ram = new Uint8Array(65536);
    ram[0xdd00] = 0xfe; // (~0xFE) & 0x03 = 1 → bank 1
    expect(computeVicBankStart(ram)).toBe(0x4000);
  });

  it("bank 2 ($DD00=0xFD) → bank base $8000", () => {
    const ram = new Uint8Array(65536);
    ram[0xdd00] = 0xfd; // (~0xFD) & 0x03 = 2 → bank 2
    expect(computeVicBankStart(ram)).toBe(0x8000);
  });

  it("bank 3 ($DD00=0xFC) → bank base $C000", () => {
    const ram = new Uint8Array(65536);
    ram[0xdd00] = 0xfc; // (~0xFC) & 0x03 = 3 → bank 3
    expect(computeVicBankStart(ram)).toBe(0xc000);
  });
});

describe("createSnapshot – custom", () => {
  it("saves snapshot with the provided range", async () => {
    await createSnapshot(mockApi, {
      type: "custom",
      customRanges: [{ start: 0x0400, length: 0x03e8 }],
    });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.snapshotType).toBe("custom");
    expect(saved.metadata.display_ranges[0]).toContain("$0400");
  });

  it("supports multiple custom ranges", async () => {
    await createSnapshot(mockApi, {
      type: "custom",
      customRanges: [
        { start: 0x0400, length: 0x100 },
        { start: 0xd800, length: 0x100 },
      ],
    });
    const saved = saveSnapshotToStoreMock.mock.calls[0][0];
    expect(saved.metadata.display_ranges).toHaveLength(2);
  });

  it("throws when no customRanges provided", async () => {
    await expect(createSnapshot(mockApi, { type: "custom" })).rejects.toThrow(
      "Custom snapshot requires at least one memory range.",
    );
  });

  it("throws when customRanges is empty array", async () => {
    await expect(createSnapshot(mockApi, { type: "custom", customRanges: [] })).rejects.toThrow(
      "Custom snapshot requires at least one memory range.",
    );
  });
});
