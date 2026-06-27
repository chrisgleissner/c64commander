/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  buildCrt,
  CHIP_TYPE_ROM,
  CRT_HEADER_SIZE,
  CRT_MAGIC,
  CRT_VERSION_1_0,
  LINE_ASSERTED,
  LINE_DEASSERTED,
} from "@/lib/snapshot/cpu/crt";
import { validateFileBytes } from "@/lib/fileValidation";

const ascii = (bytes: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...bytes.subarray(start, start + len));

const be16 = (bytes: Uint8Array, off: number) => (bytes[off]! << 8) | bytes[off + 1]!;
const be32 = (bytes: Uint8Array, off: number) =>
  bytes[off]! * 0x1000000 + bytes[off + 1]! * 0x10000 + bytes[off + 2]! * 0x100 + bytes[off + 3]!;

const image = (size: number, fill = 0xea) => {
  const b = new Uint8Array(size);
  b.fill(fill);
  return b;
};

describe("buildCrt — header", () => {
  it("writes the 16-byte magic and a 64-byte header length", () => {
    const crt = buildCrt({ chips: [{ loadAddress: 0x8000, data: image(0x2000) }] });
    expect(ascii(crt, 0, 16)).toBe(CRT_MAGIC);
    expect(be32(crt, 16)).toBe(CRT_HEADER_SIZE);
    expect(be16(crt, 20)).toBe(CRT_VERSION_1_0);
  });

  it("defaults to an Ultimax line configuration (EXROM asserted, GAME de-asserted)", () => {
    const crt = buildCrt({ chips: [{ loadAddress: 0x8000, data: image(0x2000) }] });
    expect(crt[24]).toBe(LINE_ASSERTED); // EXROM
    expect(crt[25]).toBe(LINE_DEASSERTED); // GAME
  });

  it("honours explicit hardware type / EXROM / GAME", () => {
    const crt = buildCrt({
      hwType: 0,
      exrom: LINE_ASSERTED,
      game: LINE_ASSERTED,
      chips: [{ loadAddress: 0x8000, data: image(0x2000) }],
    });
    expect(be16(crt, 22)).toBe(0);
    expect(crt[24]).toBe(LINE_ASSERTED);
    expect(crt[25]).toBe(LINE_ASSERTED);
  });

  it("writes a NUL-padded 32-byte name and truncates an over-long name", () => {
    const crt = buildCrt({ name: "RESTORE", chips: [{ loadAddress: 0x8000, data: image(16) }] });
    expect(ascii(crt, 32, 7)).toBe("RESTORE");
    expect(crt[39]).toBe(0); // padding

    const longName = "X".repeat(50);
    const crt2 = buildCrt({ name: longName, chips: [{ loadAddress: 0x8000, data: image(16) }] });
    // Name field is exactly 32 bytes; the first CHIP packet starts at offset 64.
    expect(ascii(crt2, 64, 4)).toBe("CHIP");
  });
});

describe("buildCrt — CHIP packets", () => {
  it("writes a single ROM CHIP packet with correct framing", () => {
    const data = image(0x2000, 0x42);
    const crt = buildCrt({ chips: [{ loadAddress: 0x8000, data }] });

    expect(ascii(crt, 64, 4)).toBe("CHIP");
    expect(be32(crt, 68)).toBe(16 + data.length); // packet length
    expect(be16(crt, 72)).toBe(CHIP_TYPE_ROM);
    expect(be16(crt, 74)).toBe(0); // bank
    expect(be16(crt, 76)).toBe(0x8000); // load address
    expect(be16(crt, 78)).toBe(data.length); // image size
    expect(Array.from(crt.subarray(80, 80 + data.length))).toEqual(Array.from(data));
    expect(crt.length).toBe(CRT_HEADER_SIZE + 16 + data.length);
  });

  it("concatenates multiple CHIP packets", () => {
    const a = image(0x2000, 0x11);
    const b = image(0x2000, 0x22);
    const crt = buildCrt({
      chips: [
        { loadAddress: 0x8000, data: a },
        { loadAddress: 0xe000, bank: 0, data: b },
      ],
    });
    const firstPacketEnd = 64 + 16 + a.length;
    expect(ascii(crt, 64, 4)).toBe("CHIP");
    expect(ascii(crt, firstPacketEnd, 4)).toBe("CHIP");
    expect(be16(crt, firstPacketEnd + 12)).toBe(0xe000); // second load address
  });

  it("throws when no CHIP packet is supplied", () => {
    expect(() => buildCrt({ chips: [] })).toThrow(/at least one CHIP/);
  });

  it("throws on an out-of-range load address", () => {
    expect(() => buildCrt({ chips: [{ loadAddress: 0x10000, data: image(16) }] })).toThrow(/loadAddress/);
  });

  it("throws when a control line is not a byte", () => {
    expect(() => buildCrt({ exrom: 256, chips: [{ loadAddress: 0x8000, data: image(16) }] })).toThrow(
      /exrom must be a byte/,
    );
    expect(() => buildCrt({ game: -1, chips: [{ loadAddress: 0x8000, data: image(16) }] })).toThrow(
      /game must be a byte/,
    );
  });

  it("throws when the hardware type is not a 16-bit value", () => {
    expect(() => buildCrt({ hwType: 0x10000, chips: [{ loadAddress: 0x8000, data: image(16) }] })).toThrow(
      /hwType must be a 16-bit value/,
    );
  });
});

describe("buildCrt — accepted by the repo's own CRT validator", () => {
  it("produces a structurally valid .crt (validateFileBytes)", () => {
    const crt = buildCrt({
      name: "C64C RESTORE",
      chips: [{ loadAddress: 0x8000, data: image(0x2000) }],
    });
    const result = validateFileBytes(crt, "crt");
    expect(result.ok).toBe(true);
    expect(result.detectedType).toBe("crt");
  });

  it("validates an 8 KiB Ultimax cart with mirrored ROML/ROMH packets", () => {
    const rom = image(0x2000);
    const crt = buildCrt({
      exrom: LINE_ASSERTED,
      game: LINE_DEASSERTED,
      chips: [
        { loadAddress: 0x8000, data: rom },
        { loadAddress: 0xe000, data: rom },
      ],
    });
    expect(validateFileBytes(crt, "crt").ok).toBe(true);
  });
});
