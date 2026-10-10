/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { VIC_BYTES_PER_FRAME } from "@/lib/streams/vicDecode";
import { VIC_BYTES_PER_LINE } from "@/lib/streams/vicStream";
import { VideoFrameDeltaDecoder, WHOLE_FRAME, base64ToBytes } from "@/lib/streams/videoFrameDelta";

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const frameOf = (fill: number) => new Uint8Array(VIC_BYTES_PER_FRAME).fill(fill);

describe("VideoFrameDeltaDecoder", () => {
  it("decodes base64 to the same bytes whichever decoder the WebView has", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(Array.from(base64ToBytes(encode(bytes)))).toEqual(Array.from(bytes));
  });

  it("takes a whole frame as it is", () => {
    const decoder = new VideoFrameDeltaDecoder();
    const frame = decoder.apply({ data: encode(frameOf(3)), firstLine: 0, lineCount: WHOLE_FRAME });
    expect(frame).toEqual(frameOf(3));
  });

  it("treats a frame without span fields as whole, as an older plugin sends it", () => {
    const decoder = new VideoFrameDeltaDecoder();
    expect(decoder.apply({ data: encode(frameOf(7)) })).toEqual(frameOf(7));
  });

  it("patches only the changed lines into a new copy and leaves the previous frame untouched", () => {
    const decoder = new VideoFrameDeltaDecoder();
    const first = decoder.apply({ data: encode(frameOf(0)), lineCount: WHOLE_FRAME })!;
    const lines = new Uint8Array(2 * VIC_BYTES_PER_LINE).fill(9);
    const second = decoder.apply({ data: encode(lines), firstLine: 10, lineCount: 2 })!;

    expect(second).not.toBe(first);
    expect(first.every((byte) => byte === 0)).toBe(true);
    expect(second.slice(10 * VIC_BYTES_PER_LINE, 12 * VIC_BYTES_PER_LINE).every((byte) => byte === 9)).toBe(true);
    expect(second.slice(0, 10 * VIC_BYTES_PER_LINE).every((byte) => byte === 0)).toBe(true);
    expect(second.slice(12 * VIC_BYTES_PER_LINE).every((byte) => byte === 0)).toBe(true);
  });

  it("hands back the previous frame itself when no line changed", () => {
    const decoder = new VideoFrameDeltaDecoder();
    const first = decoder.apply({ data: encode(frameOf(1)), lineCount: WHOLE_FRAME });
    expect(decoder.apply({ data: "", firstLine: 0, lineCount: 0 })).toBe(first);
  });

  it("cannot rebuild a span before it has had a whole frame", () => {
    const decoder = new VideoFrameDeltaDecoder();
    expect(decoder.apply({ data: "", firstLine: 0, lineCount: 0 })).toBeNull();
    const line = encode(new Uint8Array(VIC_BYTES_PER_LINE));
    expect(decoder.apply({ data: line, firstLine: 3, lineCount: 1 })).toBeNull();
  });

  it("refuses a span that does not fit the frame, and keeps the frame it had", () => {
    const decoder = new VideoFrameDeltaDecoder();
    const first = decoder.apply({ data: encode(frameOf(5)), lineCount: WHOLE_FRAME });
    const line = encode(new Uint8Array(VIC_BYTES_PER_LINE));
    expect(() => decoder.apply({ data: line, firstLine: 272, lineCount: 1 })).toThrow(/out of range/);
    expect(() => decoder.apply({ data: line, firstLine: 0, lineCount: 2 })).toThrow(/out of range/);
    expect(decoder.apply({ data: "", lineCount: 0 })).toBe(first);
  });
});
