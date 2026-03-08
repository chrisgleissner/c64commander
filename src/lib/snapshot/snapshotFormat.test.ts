/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { decodeSnapshot, encodeSnapshot } from "./snapshotFormat";
import type { MemoryRange, SnapshotMetadata } from "./snapshotTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeBlock = (size: number, fill = 0xaa): Uint8Array => {
  const b = new Uint8Array(size);
  b.fill(fill);
  return b;
};

const RANGES: MemoryRange[] = [
  { start: 0x0000, length: 4 },
  { start: 0x1000, length: 8 },
];
const BLOCKS = [makeBlock(4, 0x11), makeBlock(8, 0x22)];
const TS = new Date(1_700_000_000_000); // exact unix second

// ---------------------------------------------------------------------------
// Round-trip (no metadata)
// ---------------------------------------------------------------------------

describe("encodeSnapshot / decodeSnapshot", () => {
  it("round-trips type, timestamp, ranges and blocks without metadata", () => {
    const bytes = encodeSnapshot("full", TS, RANGES, BLOCKS);
    const decoded = decodeSnapshot(bytes);

    expect(decoded.snapshotType).toBe("full");
    // Timestamps are stored at second precision
    expect(Math.floor(decoded.timestamp.getTime() / 1000)).toBe(Math.floor(TS.getTime() / 1000));
    expect(decoded.ranges).toEqual(RANGES);
    expect(decoded.blocks[0]).toEqual(BLOCKS[0]);
    expect(decoded.blocks[1]).toEqual(BLOCKS[1]);
    expect(decoded.metadata).toBeNull();
    expect(decoded.version).toBe(1);
  });

  it("round-trips all snapshot types", () => {
    const types: Array<"full" | "basic" | "screen" | "custom"> = ["full", "basic", "screen", "custom"];
    for (const type of types) {
      const bytes = encodeSnapshot(type, TS, [{ start: 0, length: 1 }], [new Uint8Array([0])]);
      const decoded = decodeSnapshot(bytes);
      expect(decoded.snapshotType).toBe(type);
    }
  });

  it("round-trips with metadata attached", () => {
    const meta: SnapshotMetadata = {
      snapshot_type: "basic",
      display_ranges: ["$0801–STREND"],
      created_at: "2026-01-02 03:04:05",
      label: "My snapshot",
      app_version: "1.2.3",
    };
    const bytes = encodeSnapshot("basic", TS, RANGES, BLOCKS, meta);
    const decoded = decodeSnapshot(bytes);

    expect(decoded.metadata).not.toBeNull();
    expect(decoded.metadata!.label).toBe("My snapshot");
    expect(decoded.metadata!.snapshot_type).toBe("basic");
    expect(decoded.metadata!.display_ranges).toEqual(["$0801–STREND"]);
  });

  it("round-trips zero ranges (empty snapshot)", () => {
    const bytes = encodeSnapshot("custom", TS, [], []);
    const decoded = decodeSnapshot(bytes);
    expect(decoded.ranges).toHaveLength(0);
    expect(decoded.blocks).toHaveLength(0);
  });

  it("preserves large memory blocks", () => {
    const largeBlock = new Uint8Array(0x4000);
    for (let i = 0; i < largeBlock.length; i++) largeBlock[i] = i & 0xff;

    const bytes = encodeSnapshot("full", TS, [{ start: 0x0000, length: 0x4000 }], [largeBlock]);
    const decoded = decodeSnapshot(bytes);

    expect(decoded.blocks[0]).toEqual(largeBlock);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("decodeSnapshot error handling", () => {
  it("throws on data that is too short", () => {
    expect(() => decodeSnapshot(new Uint8Array(4))).toThrow(/too short/);
  });

  it("throws on bad magic bytes", () => {
    const bad = new Uint8Array(28);
    bad.set(new TextEncoder().encode("BADMAGIC"));
    expect(() => decodeSnapshot(bad)).toThrow(/bad magic/);
  });

  it('falls back to "custom" for an unknown type code', () => {
    const valid = encodeSnapshot("full", TS, [], []);
    // Patch type code field at offset 10 (uint16) to an unknown value
    const patched = new Uint8Array(valid);
    new DataView(patched.buffer).setUint16(10, 255, true);
    const decoded = decodeSnapshot(patched);
    expect(decoded.snapshotType).toBe("custom");
  });

  it("throws on unsupported version", () => {
    const valid = encodeSnapshot("full", TS, [], []);
    // Patch version field at offset 8 (uint16)
    const patched = new Uint8Array(valid);
    new DataView(patched.buffer).setUint16(8, 99, true);
    expect(() => decodeSnapshot(patched)).toThrow(/Unsupported/);
  });

  it("throws on truncated range descriptors", () => {
    const valid = encodeSnapshot("full", TS, RANGES, BLOCKS);
    // Truncate to just 29 bytes so the range descriptors are cut off
    expect(() => decodeSnapshot(valid.slice(0, 29))).toThrow(/truncated/i);
  });

  it("throws on truncated memory block", () => {
    const valid = encodeSnapshot("full", TS, RANGES, BLOCKS);
    // Keep header + descriptors but truncate the first block mid-way
    const headerAndDesc = 28 + RANGES.length * 4;
    expect(() => decodeSnapshot(valid.slice(0, headerAndDesc + 2))).toThrow(/truncated/i);
  });

  it("throws on malformed metadata JSON", () => {
    const valid = encodeSnapshot("full", TS, [], [], {
      snapshot_type: "full",
      display_ranges: [],
      created_at: "2026-01-01 00:00:00",
    });
    // Corrupt the last byte (inside the JSON)
    const patched = new Uint8Array(valid);
    patched[patched.length - 1] = 0x00; // null byte makes JSON invalid
    expect(() => decodeSnapshot(patched)).toThrow(/malformed metadata/i);
  });

  it("throws on truncated metadata (offset + size beyond file)", () => {
    const valid = encodeSnapshot("full", TS, [], [], {
      snapshot_type: "full",
      display_ranges: [],
      created_at: "2026-01-01 00:00:00",
    });
    // Truncate to just the header + range descriptors, dropping the metadata bytes
    // but keep the header pointing to metadata (don't touch offsets)
    // Simply truncate by 5 bytes from end so metadataOffset + metadataSize > bytes.length
    expect(() => decodeSnapshot(valid.slice(0, valid.length - 5))).toThrow(/truncated/i);
  });
});

// ---------------------------------------------------------------------------
// encodeSnapshot validation
// ---------------------------------------------------------------------------

describe("encodeSnapshot validation", () => {
  it("throws when ranges and blocks arrays differ in length", () => {
    expect(() => encodeSnapshot("full", TS, [{ start: 0, length: 4 }], [])).toThrow(/ranges.length/);
  });
});
