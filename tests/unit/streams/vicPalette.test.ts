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
  __resetVicPalette,
  REFERENCE_VIC_PALETTE,
  activeVicPalette,
  activeVicPaletteLut,
  paletteEntryHex,
  setActiveVicPalette,
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

  it("keeps Default identical to the reference table the device renders with", () => {
    // Adopting the generated tables must be a no-op for anyone who never opens the setting.
    expect(REFERENCE_VIC_PALETTE.id).toBe("default");
    expect(REFERENCE_VIC_PALETTE.rgb.map((entry) => [...entry])).toEqual(VIC_PALETTE_RGB.map((entry) => [...entry]));
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
    subscribeVicPalette(listener);
    const before = activeVicPaletteLut();

    setActiveVicPalette("monochrome");

    expect(activeVicPalette().id).toBe("monochrome");
    expect(activeVicPaletteLut()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persists the choice", () => {
    setActiveVicPalette("night");

    __resetVicPalette();

    expect(activeVicPalette().id).toBe("night");
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
