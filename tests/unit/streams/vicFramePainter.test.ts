/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  VIC_BYTES_PER_FRAME,
  VIC_FRAME_WIDTH,
  VIC_NTSC_HEIGHT,
  VIC_PAL_HEIGHT,
  VIC_PIXELS_PER_FRAME,
  buildPaletteLUT,
  decodeVicFrameToRGBA,
} from "@/lib/streams/vicDecode";
import { VicFramePainter } from "@/lib/streams/vicFramePainter";

const BYTES_PER_LINE = VIC_FRAME_WIDTH / 2;
// Little-endian words, so a pixel's bytes read R, G, B, A in memory like the reference decoder's output.
const lut = buildPaletteLUT(true);

const frameWithLine = (line: number, value: number) => {
  const frame = new Uint8Array(VIC_BYTES_PER_FRAME);
  frame.fill(value, line * BYTES_PER_LINE, (line + 1) * BYTES_PER_LINE);
  return frame;
};

const reference = (frame: Uint8Array, lines = VIC_PAL_HEIGHT) =>
  new Uint32Array(decodeVicFrameToRGBA(frame).buffer.slice(0, lines * VIC_FRAME_WIDTH * 4));

describe("VicFramePainter", () => {
  it("paints the first frame in full, exactly as the whole-frame decoder does", () => {
    const painter = new VicFramePainter();
    const frame = frameWithLine(5, 0x21);
    const pixels = new Uint32Array(VIC_PIXELS_PER_FRAME);
    expect(painter.paint(frame, VIC_PAL_HEIGHT, pixels, lut)).toEqual({ firstLine: 0, lineCount: VIC_PAL_HEIGHT });
    expect(pixels).toEqual(reference(frame));
  });

  it("paints nothing for the same frame again", () => {
    const painter = new VicFramePainter();
    const frame = frameWithLine(5, 0x21);
    const pixels = new Uint32Array(VIC_PIXELS_PER_FRAME);
    painter.paint(frame, VIC_PAL_HEIGHT, pixels, lut);
    expect(painter.paint(frame, VIC_PAL_HEIGHT, pixels, lut)).toBeNull();
    expect(painter.paint(frame.slice(), VIC_PAL_HEIGHT, pixels, lut)).toBeNull();
  });

  it("repaints only the span of changed lines, leaving the picture identical to a full decode", () => {
    const painter = new VicFramePainter();
    const pixels = new Uint32Array(VIC_PIXELS_PER_FRAME);
    painter.paint(new Uint8Array(VIC_BYTES_PER_FRAME), VIC_PAL_HEIGHT, pixels, lut);
    const next = frameWithLine(40, 0x33);
    next.fill(0x44, 90 * BYTES_PER_LINE, 91 * BYTES_PER_LINE);
    expect(painter.paint(next, VIC_PAL_HEIGHT, pixels, lut)).toEqual({ firstLine: 40, lineCount: 51 });
    expect(pixels).toEqual(reference(next));
  });

  it("compares byte by byte when a frame is not word aligned", () => {
    const painter = new VicFramePainter();
    const pixels = new Uint32Array(VIC_PIXELS_PER_FRAME);
    const backing = new Uint8Array(VIC_BYTES_PER_FRAME + 1);
    const unaligned = backing.subarray(1);
    painter.paint(unaligned, VIC_PAL_HEIGHT, pixels, lut);
    const next = new Uint8Array(VIC_BYTES_PER_FRAME + 1).subarray(1);
    next[7 * BYTES_PER_LINE + 3] = 0x12;
    expect(painter.paint(next, VIC_PAL_HEIGHT, pixels, lut)).toEqual({ firstLine: 7, lineCount: 1 });
    expect(pixels).toEqual(reference(next));
  });

  it("paints in full again after a height change or an invalidate", () => {
    const painter = new VicFramePainter();
    const pixels = new Uint32Array(VIC_PIXELS_PER_FRAME);
    const frame = new Uint8Array(VIC_BYTES_PER_FRAME);
    painter.paint(frame, VIC_PAL_HEIGHT, pixels, lut);
    expect(painter.paint(frame, VIC_NTSC_HEIGHT, pixels, lut)).toEqual({ firstLine: 0, lineCount: VIC_NTSC_HEIGHT });
    painter.invalidate();
    expect(painter.paint(frame, VIC_NTSC_HEIGHT, pixels, lut)).toEqual({ firstLine: 0, lineCount: VIC_NTSC_HEIGHT });
  });

  it("never writes past the pixels it was given", () => {
    const painter = new VicFramePainter();
    const pixels = new Uint32Array(VIC_FRAME_WIDTH * VIC_NTSC_HEIGHT);
    expect(painter.paint(new Uint8Array(VIC_BYTES_PER_FRAME), VIC_PAL_HEIGHT, pixels, lut)).toEqual({
      firstLine: 0,
      lineCount: VIC_NTSC_HEIGHT,
    });
  });
});
