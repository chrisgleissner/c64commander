/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability E — VIC 4bpp → RGBA decode.
 *
 * The device video stream carries 384×272 frames at 4 bits per pixel (two pixels
 * per byte: low nibble = left, high nibble = right). Decode is a single palette-LUT
 * write per pixel (no per-pixel branching) plus one putImageData by the caller, so
 * CPU cost is fixed regardless of display size (the GPU integer-scales the canvas).
 */

export const VIC_FRAME_WIDTH = 384;
export const VIC_PAL_HEIGHT = 272;
export const VIC_NTSC_HEIGHT = 240;
/** Frame storage is always PAL-sized (272 lines); NTSC (240) is a subset. */
export const VIC_FRAME_HEIGHT = VIC_PAL_HEIGHT;
export const VIC_BYTES_PER_FRAME = (VIC_FRAME_WIDTH * VIC_FRAME_HEIGHT) / 2; // 52224
export const VIC_PIXELS_PER_FRAME = VIC_FRAME_WIDTH * VIC_FRAME_HEIGHT;

/**
 * Clamp a packet-derived frame height into the valid [NTSC, PAL] range, matching
 * c64stream's c64_clamp_frame_height so a stray height can't overflow the buffer.
 */
export const clampFrameHeight = (height: number): number =>
  height < VIC_NTSC_HEIGHT ? VIC_NTSC_HEIGHT : height > VIC_PAL_HEIGHT ? VIC_PAL_HEIGHT : height;

export type VideoStandard = "PAL" | "NTSC";

/**
 * Classify the actual video standard from a received frame's line count: PAL frames are
 * 272 lines, NTSC 240 — so the midpoint (256) cleanly separates them. Derived from what the
 * device really streams (not a config guess), for the Live View overlay and NTSC audio-rate.
 */
export const videoStandardForHeight = (height: number): VideoStandard =>
  height >= (VIC_NTSC_HEIGHT + VIC_PAL_HEIGHT) / 2 ? "PAL" : "NTSC";

/**
 * 16-entry VIC palette (RGB) — the "C64 Ultimate Default Palette" the device
 * streams (source of truth: c64stream `data/palettes/default.vpl`), so in-app
 * video matches what the machine and OBS/c64stream render.
 */
export const VIC_PALETTE_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [0x00, 0x00, 0x00], // Black
  [0xf7, 0xf7, 0xf7], // White
  [0x8d, 0x2f, 0x34], // Red
  [0x6a, 0xd4, 0xcd], // Cyan
  [0x98, 0x35, 0xa4], // Purple
  [0x4c, 0xb4, 0x42], // Green
  [0x2c, 0x29, 0xb1], // Blue
  [0xef, 0xef, 0x5d], // Yellow
  [0x98, 0x4e, 0x20], // Orange
  [0x5b, 0x38, 0x00], // Brown
  [0xd1, 0x67, 0x6d], // Pink
  [0x4a, 0x4a, 0x4a], // Dark grey
  [0x7b, 0x7b, 0x7b], // Medium grey
  [0x9f, 0xef, 0x93], // Light green
  [0x6d, 0x6a, 0xef], // Light blue
  [0xb2, 0xb2, 0xb2], // Light grey
];

const toHex2 = (value: number) => value.toString(16).padStart(2, "0");

/** `#rrggbb` for a palette index (indices wrap into 0..15). */
export const paletteHex = (index: number): string => {
  const [r, g, b] = VIC_PALETTE_RGB[index & 0x0f];
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
};

/** Detect the platform byte order so the packed RGBA word is laid out correctly. */
export const isLittleEndian = (): boolean => {
  const probe = new Uint32Array(1);
  probe[0] = 1;
  return new Uint8Array(probe.buffer)[0] === 1;
};

/**
 * Build the 16-entry Uint32 LUT once. On little-endian the ImageData word reads as
 * 0xAABBGGRR; on big-endian as 0xRRGGBBAA. Alpha is always fully opaque.
 */
export const buildPaletteLUT = (littleEndian: boolean = isLittleEndian()): Uint32Array => {
  const lut = new Uint32Array(16);
  for (let i = 0; i < 16; i += 1) {
    const [r, g, b] = VIC_PALETTE_RGB[i];
    lut[i] = littleEndian
      ? ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
  }
  return lut;
};

/**
 * Decode a packed 4bpp frame into a 32-bit-per-pixel target using the LUT. `pixels`
 * must be a Uint32 view of the ImageData buffer (`VIC_PIXELS_PER_FRAME` long). Only
 * as many pixels as fit both buffers are written.
 */
export const decodeVicFrameInto = (frame: Uint8Array, pixels: Uint32Array, lut: Uint32Array): void => {
  const maxBytes = Math.min(frame.length, pixels.length >> 1);
  let p = 0;
  for (let i = 0; i < maxBytes; i += 1) {
    const byte = frame[i];
    pixels[p++] = lut[byte & 0x0f];
    pixels[p++] = lut[byte >> 4];
  }
};

/**
 * Reference decoder: 4bpp frame → a fresh RGBA byte array (R,G,B,A per pixel).
 * Endianness-independent; used by tests and non-canvas consumers.
 */
export const decodeVicFrameToRGBA = (frame: Uint8Array): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(VIC_PIXELS_PER_FRAME * 4);
  const maxBytes = Math.min(frame.length, VIC_BYTES_PER_FRAME);
  let o = 0;
  for (let i = 0; i < maxBytes; i += 1) {
    const byte = frame[i];
    const left = VIC_PALETTE_RGB[byte & 0x0f];
    const right = VIC_PALETTE_RGB[byte >> 4];
    out[o++] = left[0];
    out[o++] = left[1];
    out[o++] = left[2];
    out[o++] = 0xff;
    out[o++] = right[0];
    out[o++] = right[1];
    out[o++] = right[2];
    out[o++] = 0xff;
  }
  return out;
};

/**
 * The palette index of a border pixel (x=4, y=4), for tinting the surrounding UI to
 * match the running program's border colour.
 */
export const sampleBorderColorIndex = (frame: Uint8Array): number => {
  const pixelIndex = 4 * VIC_FRAME_WIDTH + 4;
  const byteIndex = pixelIndex >> 1;
  if (byteIndex >= frame.length) return 0;
  const byte = frame[byteIndex];
  return pixelIndex & 1 ? byte >> 4 : byte & 0x0f;
};
