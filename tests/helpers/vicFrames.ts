/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Synthetic packed-4bpp VIC frames, for tests and benchmarks that need a picture without a C64.
 *
 * The layout is the one the device streams: two pixels per byte, low nibble = left pixel, high
 * nibble = right, 16 palette indices. Nothing here decodes or renders — it only draws, so a test
 * can state exactly which pixels of which colour were on screen.
 */

export const FRAME_WIDTH = 384;
export const FRAME_HEIGHT = 272;

export const createFrame = (background = 0, width = FRAME_WIDTH, height = FRAME_HEIGHT): Uint8Array => {
  const frame = new Uint8Array((width * height) / 2);
  frame.fill(((background & 0x0f) << 4) | (background & 0x0f));
  return frame;
};

export const setPixel = (frame: Uint8Array, x: number, y: number, colour: number, width = FRAME_WIDTH): void => {
  const index = y * width + x;
  const byte = index >> 1;
  frame[byte] =
    (index & 1) === 1 ? (frame[byte] & 0x0f) | ((colour & 0x0f) << 4) : (frame[byte] & 0xf0) | (colour & 0x0f);
};

export const getPixel = (frame: Uint8Array, x: number, y: number, width = FRAME_WIDTH): number => {
  const index = y * width + x;
  const byte = frame[index >> 1];
  return (index & 1) === 1 ? (byte >> 4) & 0x0f : byte & 0x0f;
};

/** Fill a rectangle, clipped to the frame. */
export const fillRect = (
  frame: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: number,
  width = FRAME_WIDTH,
  height = FRAME_HEIGHT,
): void => {
  for (let row = Math.max(0, y); row < Math.min(height, y + h); row += 1) {
    for (let col = Math.max(0, x); col < Math.min(width, x + w); col += 1) {
      setPixel(frame, col, row, colour, width);
    }
  }
};

/**
 * Draw a shape from an ASCII mask — every character other than `.` and a space is drawn — with
 * `(x, y)` its top-left corner. A test that changes an object's silhouette can then show the two
 * silhouettes side by side in the source.
 */
export const drawMask = (
  frame: Uint8Array,
  mask: readonly string[],
  x: number,
  y: number,
  colour: number,
  width = FRAME_WIDTH,
  height = FRAME_HEIGHT,
): void => {
  for (let row = 0; row < mask.length; row += 1) {
    const line = mask[row];
    for (let col = 0; col < line.length; col += 1) {
      const cell = line[col];
      if (cell === "." || cell === " ") continue;
      const px = x + col;
      const py = y + row;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      setPixel(frame, px, py, colour, width);
    }
  }
};

/** A dotted backdrop, so a test is not tracking against a single flat colour. */
export const speckle = (
  frame: Uint8Array,
  colour: number,
  spacing = 16,
  width = FRAME_WIDTH,
  height = FRAME_HEIGHT,
): void => {
  for (let y = 0; y < height; y += spacing) {
    for (let x = 0; x < width; x += spacing) {
      setPixel(frame, x, y, colour, width);
    }
  }
};
