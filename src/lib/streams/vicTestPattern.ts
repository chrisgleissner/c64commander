/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Synthetic VIC stream test pattern — the c64stream "reproducible test pattern + measure that every
 * frame arrives" approach, applied to the app's own packet format. The device streams one VIC frame
 * per raster refresh (50Hz PAL / 60Hz NTSC); to prove the receive pipeline never loses or corrupts a
 * frame we generate a DETERMINISTIC packet stream whose every frame's content is a pure function of
 * its frame number, feed it through the assembler (JS) or the native socket (Kotlin), and assert that
 * frames 0..N-1 all arrive, in order, byte-exact, with zero frame loss.
 *
 * Because the content of frame `f` is fully reproducible ({@link testPatternFrame}), a decoded frame
 * can be checked to be EXACTLY frame `f` — so a silently dropped, duplicated, stale or reordered frame
 * is caught, not just a missing one.
 */

import {
  VIC_HEADER_BYTES,
  VIC_BYTES_PER_LINE,
  VIC_LAST_LINE_FLAG,
  VIC_LINES_PER_PACKET,
  VIC_BITS_PER_PIXEL,
} from "./vicStream";
import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT, VIC_BYTES_PER_FRAME } from "./vicDecode";

/**
 * The reproducible frame content for frame `frameNum`: `frame[i] = (frameNum * 131 + i * 7) & 0xFF`.
 * A pure function of (frameNum, byteIndex), so the same frame number always yields the same bytes and
 * different frame numbers almost never collide — letting a test assert a decoded frame IS frame N.
 * Always PAL-sized (52224 bytes); NTSC uses the first `height*192` bytes.
 */
export const testPatternFrame = (frameNum: number): Uint8Array => {
  const frame = new Uint8Array(VIC_BYTES_PER_FRAME);
  const base = (frameNum * 131) & 0xff;
  for (let i = 0; i < VIC_BYTES_PER_FRAME; i += 1) frame[i] = (base + i * 7) & 0xff;
  return frame;
};

/**
 * Split a full VIC frame into its wire packets: {@link VIC_LINES_PER_PACKET}-line groups, each a
 * 12-byte little-endian header + 768-byte payload, with the last-line flag set on the final packet.
 * `startSeq` seeds the (wrapping u16) sequence counter so a caller can produce a continuous stream.
 */
export const packetizeVicFrame = (
  frame: Uint8Array,
  frameNum: number,
  height: number,
  startSeq: number,
): { packets: Uint8Array[]; nextSeq: number } => {
  const packets: Uint8Array[] = [];
  const lineGroups = Math.ceil(height / VIC_LINES_PER_PACKET);
  let seq = startSeq & 0xffff;
  for (let g = 0; g < lineGroups; g += 1) {
    const line = g * VIC_LINES_PER_PACKET;
    const isLast = g === lineGroups - 1;
    const packet = new Uint8Array(VIC_HEADER_BYTES + VIC_LINES_PER_PACKET * VIC_BYTES_PER_LINE);
    const view = new DataView(packet.buffer);
    view.setUint16(0, seq, true);
    view.setUint16(2, frameNum & 0xffff, true);
    view.setUint16(4, (line & 0x7fff) | (isLast ? VIC_LAST_LINE_FLAG : 0), true);
    view.setUint16(6, VIC_FRAME_WIDTH, true);
    packet[8] = VIC_LINES_PER_PACKET;
    packet[9] = VIC_BITS_PER_PIXEL;
    view.setUint16(10, 0, true);
    const srcOffset = line * VIC_BYTES_PER_LINE;
    packet.set(frame.subarray(srcOffset, srcOffset + VIC_LINES_PER_PACKET * VIC_BYTES_PER_LINE), VIC_HEADER_BYTES);
    packets.push(packet);
    seq = (seq + 1) & 0xffff;
  }
  return { packets, nextSeq: seq };
};

export interface TestPatternStream {
  /** All packets for the whole run, in wire order. */
  packets: Uint8Array[];
  /** The frame numbers emitted, in order (accounts for the starting number + wraparound). */
  frameNumbers: number[];
}

/**
 * Build a continuous synthetic stream of `frameCount` frames starting at `startFrame` (u16, wraps),
 * each packetized at `height` lines with a monotonic sequence counter. This is the reproducible
 * "test pattern" fed to the assembler / native socket to verify every frame arrives.
 */
export const buildTestPatternStream = (
  frameCount: number,
  { startFrame = 0, height = VIC_PAL_HEIGHT, startSeq = 0 }: { startFrame?: number; height?: number; startSeq?: number } = {},
): TestPatternStream => {
  const packets: Uint8Array[] = [];
  const frameNumbers: number[] = [];
  let seq = startSeq & 0xffff;
  for (let i = 0; i < frameCount; i += 1) {
    const frameNum = (startFrame + i) & 0xffff;
    frameNumbers.push(frameNum);
    const frame = testPatternFrame(frameNum);
    const out = packetizeVicFrame(frame, frameNum, height, seq);
    packets.push(...out.packets);
    seq = out.nextSeq;
  }
  return { packets, frameNumbers };
};

/**
 * Whether a decoded/assembled frame is byte-exact for the expected frame number, over its active
 * region (first `height*192` bytes — NTSC leaves the tail rows untouched). Returns the first
 * mismatching byte index, or -1 if it matches.
 */
export const firstFrameMismatch = (frame: Uint8Array, expectedFrameNum: number, height: number): number => {
  const expected = testPatternFrame(expectedFrameNum);
  const activeBytes = Math.min(height * VIC_BYTES_PER_LINE, VIC_BYTES_PER_FRAME, frame.length);
  for (let i = 0; i < activeBytes; i += 1) if (frame[i] !== expected[i]) return i;
  return -1;
};
