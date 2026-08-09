/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIC_PALETTES } from "@/generated/vicPalettes";
import {
  DEVICE_VIC_PALETTE_ID,
  __resetVicPalette,
  REFERENCE_VIC_PALETTE,
  U64_FIRMWARE_DEFAULT_VIC_PALETTE,
  activeVicPalette,
  activeVicPaletteLut,
  paletteEntryHex,
  setActiveVicPalette,
  setActiveVicPaletteDefinition,
  subscribeVicPalette,
  vicPaletteById,
} from "@/lib/streams/vicPalette";
import { VIC_PALETTE_RGB, buildPaletteLUT, decodeVicFrameInto } from "@/lib/streams/vicDecode";

describe("the bundled palettes", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
  });

  it("ships every c64stream palette, each with all 16 VIC colours", () => {
    expect(VIC_PALETTES.length).toBeGreaterThanOrEqual(9);
    expect(VIC_PALETTES.map((palette) => palette.id)).toContain("default");
    for (const palette of VIC_PALETTES) {
      expect(palette.rgb, palette.id).toHaveLength(16);
      for (const [r, g, b] of palette.rgb) {
        for (const channel of [r, g, b]) {
          expect(Number.isInteger(channel) && channel >= 0 && channel <= 255, palette.id).toBe(true);
        }
      }
      expect(palette.name.length, palette.id).toBeGreaterThan(0);
    }
  });

  it("keeps Default identical to the firmware fallback the device renders with", () => {
    expect(REFERENCE_VIC_PALETTE.id).toBe("default");
    expect(U64_FIRMWARE_DEFAULT_VIC_PALETTE.rgb).toEqual([
      [0x00, 0x00, 0x00],
      [0xf7, 0xf7, 0xf7],
      [0x8d, 0x2f, 0x34],
      [0x6a, 0xd4, 0xcd],
      [0x98, 0x35, 0xa4],
      [0x4c, 0xb4, 0x42],
      [0x2c, 0x29, 0xb1],
      [0xef, 0xef, 0x5d],
      [0x98, 0x4e, 0x20],
      [0x5b, 0x38, 0x00],
      [0xd1, 0x67, 0x6d],
      [0x4a, 0x4a, 0x4a],
      [0x7b, 0x7b, 0x7b],
      [0x9f, 0xef, 0x93],
      [0x6d, 0x6a, 0xef],
      [0xb2, 0xb2, 0xb2],
    ]);
    expect(REFERENCE_VIC_PALETTE.rgb).toEqual(U64_FIRMWARE_DEFAULT_VIC_PALETTE.rgb);
    expect(VIC_PALETTE_RGB).toEqual(U64_FIRMWARE_DEFAULT_VIC_PALETTE.rgb);
  });

  it("falls back to the reference palette for an id it does not know", () => {
    // A stored id from an older build must not paint from an empty table.
    expect(vicPaletteById("a-palette-that-was-removed").id).toBe("default");
  });

  it("renders a swatch as #rrggbb", () => {
    expect(paletteEntryHex(REFERENCE_VIC_PALETTE, 0)).toBe("#000000");
    expect(paletteEntryHex(REFERENCE_VIC_PALETTE, 1)).toBe("#f7f7f7");
    // Index wraps rather than throwing, so a bad index cannot break a render.
    expect(paletteEntryHex(REFERENCE_VIC_PALETTE, 16)).toBe("#000000");
  });
});

describe("selecting a palette", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
  });

  it("swaps the lookup table and notifies once", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVicPalette(listener);
    const before = activeVicPaletteLut();

    setActiveVicPalette("monochrome");

    expect(activeVicPalette().id).toBe("monochrome");
    expect(activeVicPaletteLut()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setActiveVicPalette("night");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persists the choice", () => {
    setActiveVicPalette("night");

    __resetVicPalette();

    expect(activeVicPalette().id).toBe("night");
  });

  it("starts in automatic device mode while rendering Default until a VPL is available", () => {
    expect(localStorage.getItem("c64u_vic_palette")).toBeNull();
    expect(activeVicPalette().id).toBe("default");

    setActiveVicPalette(DEVICE_VIC_PALETTE_ID);

    expect(localStorage.getItem("c64u_vic_palette")).toBe(DEVICE_VIC_PALETTE_ID);
    expect(activeVicPalette().id).toBe("default");
  });

  it("keeps the current device palette in place when automatic mode is selected", () => {
    setActiveVicPalette("monochrome");
    const lut = activeVicPaletteLut();

    setActiveVicPalette(DEVICE_VIC_PALETTE_ID);

    expect(activeVicPalette().id).toBe("monochrome");
    expect(activeVicPaletteLut()).toBe(lut);
  });

  it("does not rebuild or notify when the device returns the palette already in use", () => {
    const palette = {
      id: "device:/Usb0/current.vpl",
      name: "Current device palette",
      description: "Current",
      rgb: U64_FIRMWARE_DEFAULT_VIC_PALETTE.rgb.map((entry) => [...entry]),
    };
    setActiveVicPaletteDefinition(palette);
    const listener = vi.fn();
    subscribeVicPalette(listener);
    const lut = activeVicPaletteLut();

    setActiveVicPaletteDefinition({ ...palette, rgb: palette.rgb.map((entry) => [...entry]) });

    expect(activeVicPaletteLut()).toBe(lut);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does nothing at all when the same palette is picked again", () => {
    setActiveVicPalette("warm");
    const listener = vi.fn();
    subscribeVicPalette(listener);
    const lut = activeVicPaletteLut();

    setActiveVicPalette("warm");

    // Re-selecting must not churn the table the decode loop is holding a reference to.
    expect(activeVicPaletteLut()).toBe(lut);
    expect(listener).not.toHaveBeenCalled();
  });
});

/**
 * The point of this whole design: a palette is a 16-entry table, and decoding was ALREADY a lookup
 * into a 16-entry table. Selecting a palette therefore costs nothing per frame and nothing per
 * pixel — it only changes which table is passed in.
 */
describe("the decode hot path", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
  });

  it("hands back the same table object every time, so no work happens per frame", () => {
    const first = activeVicPaletteLut();

    for (let frame = 0; frame < 500; frame += 1) expect(activeVicPaletteLut()).toBe(first);
  });

  it("builds a new table only when the selection changes", () => {
    const a = activeVicPaletteLut();
    setActiveVicPalette("cool");
    const b = activeVicPaletteLut();
    setActiveVicPalette("cool");

    expect(b).not.toBe(a);
    expect(activeVicPaletteLut()).toBe(b);
  });

  it("decodes through the table without knowing a palette exists", () => {
    // decodeVicFrameInto takes the LUT as an argument and has no palette parameter at all; the same
    // frame bytes through two tables give two different pictures, at identical cost.
    const frame = new Uint8Array([0x10, 0x32]); // indices 0,1,2,3
    const viaDefault = new Uint32Array(4);
    const viaMono = new Uint32Array(4);

    decodeVicFrameInto(frame, viaDefault, buildPaletteLUT(true, REFERENCE_VIC_PALETTE.rgb));
    decodeVicFrameInto(frame, viaMono, buildPaletteLUT(true, vicPaletteById("monochrome").rgb));

    expect(viaDefault[0]).toBe(viaMono[0]); // black is black in both
    expect(viaDefault[2]).not.toBe(viaMono[2]); // red is grey in monochrome
  });
});

/**
 * `inverted.vpl` maps index 0 to white and index 1 to black. Anything that ANALYSES a frame has to
 * ignore the user's display choice, or picking that palette would turn the A/V-sync flash detector
 * inside out and report a fault that exists only on screen.
 */
describe("analysis stays on the reference palette", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVicPalette();
  });

  it("proves inverted really would invert a luma-based detector", () => {
    const inverted = vicPaletteById("inverted");

    expect(inverted.rgb[0]![0]).toBeGreaterThan(200); // index 0 "Black" is painted white
    expect(inverted.rgb[1]![0]).toBeLessThan(50); // index 1 "White" is painted black
  });

  it("leaves the reference table untouched when the user picks it", async () => {
    setActiveVicPalette("inverted");

    const { VIC_PALETTE_RGB: stillReference } = await import("@/lib/streams/vicDecode");

    expect(stillReference[0]).toEqual([0x00, 0x00, 0x00]);
    expect(stillReference[1]).toEqual([0xf7, 0xf7, 0xf7]);
  });
});
