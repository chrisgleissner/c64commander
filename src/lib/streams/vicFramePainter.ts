/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { VIC_FRAME_WIDTH, decodeVicFrameInto } from "./vicDecode";

const BYTES_PER_LINE = VIC_FRAME_WIDTH / 2;
const WORDS_PER_LINE = BYTES_PER_LINE / 4;

export type PaintedLines = { firstLine: number; lineCount: number };

const wordsOf = (frame: Uint8Array): Uint32Array | null =>
  frame.byteOffset % 4 === 0 && frame.byteLength % 4 === 0
    ? new Uint32Array(frame.buffer, frame.byteOffset, frame.byteLength / 4)
    : null;

/**
 * Decodes 4bpp VIC frames into 32-bit pixels, redrawing only the lines that differ from the frame painted before.
 *
 * A still C64 screen is the common case, and repainting all 104,448 pixels of it fifty times a second was most of
 * Live View's main-thread time. The painted lines are returned so the caller copies only those to the canvas.
 */
export class VicFramePainter {
  private previous: Uint8Array | null = null;
  private previousHeight = 0;

  /** The next frame is painted in full: the canvas was cleared or replaced, or the palette changed. */
  invalidate(): void {
    this.previous = null;
  }

  /** Paints `frame` into `pixels` and returns the lines that changed, or null when none did. */
  paint(frame: Uint8Array, height: number, pixels: Uint32Array, lut: Uint32Array): PaintedLines | null {
    const lines = Math.min(
      height,
      Math.floor(frame.length / BYTES_PER_LINE),
      Math.floor(pixels.length / VIC_FRAME_WIDTH),
    );
    const previous = this.previous;
    const comparable = previous !== null && this.previousHeight === height && previous.length === frame.length;
    this.previous = frame;
    this.previousHeight = height;
    if (comparable && previous === frame) return null;
    let first = 0;
    let last = lines - 1;
    if (comparable) {
      const before = wordsOf(previous);
      const after = wordsOf(frame);
      const same =
        before && after
          ? (line: number) => {
              for (let w = line * WORDS_PER_LINE, end = w + WORDS_PER_LINE; w < end; w += 1) {
                if (before[w] !== after[w]) return false;
              }
              return true;
            }
          : (line: number) => {
              for (let b = line * BYTES_PER_LINE, end = b + BYTES_PER_LINE; b < end; b += 1) {
                if (previous[b] !== frame[b]) return false;
              }
              return true;
            };
      while (first < lines && same(first)) first += 1;
      if (first === lines) return null;
      while (last > first && same(last)) last -= 1;
    }
    decodeVicFrameInto(frame, pixels, lut, first * BYTES_PER_LINE, (last + 1) * BYTES_PER_LINE);
    return { firstLine: first, lineCount: last - first + 1 };
  }
}
