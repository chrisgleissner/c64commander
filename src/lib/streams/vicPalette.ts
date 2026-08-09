/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { DEFAULT_VIC_PALETTE_ID, VIC_PALETTES, type VicPalette } from "@/generated/vicPalettes";
import { loadVicPaletteId, saveVicPaletteId } from "@/lib/config/appSettings";
import { buildPaletteLUT } from "@/lib/streams/vicDecode";

/**
 * Which palette the app paints VIC frames with.
 *
 * The video stream carries 4-bit palette INDICES, never colour values, so this is purely a
 * rendering choice: it cannot change, improve or corrupt what the device sent. Only code that
 * PAINTS a frame should follow it — anything that ANALYSES one (the A/V-sync flash detector, the
 * tone & colour ladder's background sampling) works on indices or on the reference palette, because
 * `inverted.vpl` maps index 0 to white and index 1 to black and would turn such a detector inside
 * out.
 *
 * COST IN THE HOT PATH: none. Decoding is already a 16-entry `Uint32Array` lookup per pixel
 * (`decodeVicFrameInto`), and a palette change only swaps which 16-entry table that is. The table is
 * rebuilt here, once, when the selection actually changes — never per frame and never per pixel —
 * so the per-pixel work is byte-for-byte what it was before this setting existed.
 */

const byId = new Map(VIC_PALETTES.map((palette) => [palette.id, palette]));

export const REFERENCE_VIC_PALETTE = byId.get(DEFAULT_VIC_PALETTE_ID)!;
export const DEVICE_VIC_PALETTE_ID = "device";
export const U64_FIRMWARE_DEFAULT_VIC_PALETTE: VicPalette = {
  id: "u64-firmware-default",
  name: "Default",
  description: "C64 Ultimate Default Palette",
  rgb: [
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
  ],
};

export const vicPaletteById = (id: string): VicPalette => byId.get(id) ?? REFERENCE_VIC_PALETTE;

/**
 * Resolved on first use rather than at import.
 *
 * Reading storage while a module is still being imported makes the module order-dependent and
 * awkward to test, and there is nothing to gain from it: nothing can paint a frame before the app
 * has mounted anyway.
 */
let active: VicPalette | null = null;
let activeLut: Uint32Array | null = null;
const listeners = new Set<() => void>();

const ensureActive = (): VicPalette => {
  if (!active) {
    active = vicPaletteById(loadVicPaletteId());
    activeLut = buildPaletteLUT(undefined, active.rgb);
  }
  return active;
};

/** The palette currently being painted with. */
export const activeVicPalette = (): VicPalette => ensureActive();

/**
 * The lookup table for the active palette.
 *
 * Returns the cached table; it is never built here. Callers may hold the reference across frames
 * and refresh it from a subscription, which is what keeps the decode loop unchanged.
 */
export const activeVicPaletteLut = (): Uint32Array => {
  ensureActive();
  return activeLut!;
};

export const setActiveVicPalette = (id: string): void => {
  saveVicPaletteId(id);
  if (id === DEVICE_VIC_PALETTE_ID) return;
  const current = ensureActive();
  const next = vicPaletteById(id);
  // Rebuilding on every call would be harmless for correctness but would churn the table the decode
  // loop is holding, so a no-op selection stays a no-op.
  if (next.id === current.id) return;
  active = next;
  activeLut = buildPaletteLUT(undefined, next.rgb);
  for (const listener of listeners) listener();
};

export const setActiveVicPaletteDefinition = (palette: VicPalette): void => {
  const current = ensureActive();
  if (
    current.id === palette.id &&
    current.rgb.every((entry, index) => entry.every((value, channel) => value === palette.rgb[index]![channel]))
  ) {
    return;
  }
  active = palette;
  activeLut = buildPaletteLUT(undefined, palette.rgb);
  for (const listener of listeners) listener();
};

export const subscribeVicPalette = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test seam: restore the module to its stored state without going through the UI. */
export const __resetVicPalette = (): void => {
  active = null;
  activeLut = null;
  listeners.clear();
};

/** `#rrggbb` for one entry of a palette — for swatches and previews. */
export const paletteEntryHex = (palette: VicPalette, index: number): string => {
  const [r, g, b] = palette.rgb[index & 0x0f]!;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};

export { VIC_PALETTES, DEFAULT_VIC_PALETTE_ID };
export type { VicPalette };
