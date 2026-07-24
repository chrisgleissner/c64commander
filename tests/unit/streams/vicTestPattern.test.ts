/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { VicStreamAssembler, frameSeqDiff } from "@/lib/streams/vicStream";
import {
  buildTestPatternStream,
  firstFrameMismatch,
  packetizeVicFrame,
  testPatternFrame,
} from "@/lib/streams/vicTestPattern";
import { VIC_PAL_HEIGHT, VIC_NTSC_HEIGHT } from "@/lib/streams/vicDecode";

/**
 * Feed every packet of a synthetic stream through a fresh assembler and collect the (frameNumber,
 * frame) pairs it completes, in order. The frame number is recovered from the last-line packet just
 * ingested — but since we drive the stream, we already know the expected order.
 */
const assembleStream = (packets: Uint8Array[]) => {
  const assembler = new VicStreamAssembler();
  const frames: Uint8Array[] = [];
  for (const packet of packets) {
    const frame = assembler.ingest(packet);
    if (frame) frames.push(frame);
  }
  return { assembler, frames };
};

describe("VIC synthetic test pattern — no frame is lost", () => {
  it("reproducible content: same frame number → identical bytes, different numbers differ", () => {
    expect([...testPatternFrame(42)]).toEqual([...testPatternFrame(42)]);
    expect([...testPatternFrame(42)]).not.toEqual([...testPatternFrame(43)]);
  });

  it("delivers EVERY frame of a long PAL stream, byte-exact, with zero frame loss", () => {
    const FRAMES = 600; // ~12s at 50fps
    const { packets, frameNumbers } = buildTestPatternStream(FRAMES, { height: VIC_PAL_HEIGHT });
    const { assembler, frames } = assembleStream(packets);

    // 1) Every frame arrived — none lost, none extra.
    expect(frames).toHaveLength(FRAMES);
    expect(assembler.stats.frames).toBe(FRAMES);
    expect(assembler.stats.lostFrames).toBe(0);
    expect(assembler.stats.droppedPackets).toBe(0);

    // 2) Every arrived frame is EXACTLY the expected frame (content, in order) — no stale/dup/reorder.
    for (let i = 0; i < FRAMES; i += 1) {
      expect(firstFrameMismatch(frames[i], frameNumbers[i], VIC_PAL_HEIGHT)).toBe(-1);
    }
  });

  it("delivers every frame of an NTSC (240-line) stream, byte-exact over the active region", () => {
    const FRAMES = 600; // ~10s at 60fps
    const { packets, frameNumbers } = buildTestPatternStream(FRAMES, { height: VIC_NTSC_HEIGHT });
    const { assembler, frames } = assembleStream(packets);

    expect(frames).toHaveLength(FRAMES);
    expect(assembler.stats.lostFrames).toBe(0);
    expect(assembler.frameHeight).toBe(VIC_NTSC_HEIGHT);
    for (let i = 0; i < FRAMES; i += 1) {
      expect(firstFrameMismatch(frames[i], frameNumbers[i], VIC_NTSC_HEIGHT)).toBe(-1);
    }
  });

  it("counts a single lost frame when one frame's last-line packet is dropped", () => {
    const { packets } = buildTestPatternStream(10, { height: VIC_PAL_HEIGHT });
    const perFrame = packets.length / 10;
    // Drop the LAST packet of frame index 4 (its last-line packet) so frame 4 never completes.
    const lastPacketOfFrame4 = 5 * perFrame - 1;
    const damaged = packets.filter((_, idx) => idx !== lastPacketOfFrame4);

    const { assembler, frames } = assembleStream(damaged);
    // 9 frames complete; frame 4 is the missing one → detected as exactly 1 lost frame.
    expect(frames).toHaveLength(9);
    expect(assembler.stats.lostFrames).toBe(1);
  });

  it("counts multiple lost frames across several gaps", () => {
    const { packets } = buildTestPatternStream(12, { height: VIC_PAL_HEIGHT });
    const perFrame = packets.length / 12;
    const dropLastLineOf = new Set([2, 3, 7]); // frames 2 & 3 (adjacent) and 7 lost → 3 total
    const damaged = packets.filter((_, idx) => {
      const frameIdx = Math.floor(idx / perFrame);
      const isLastOfFrame = idx % perFrame === perFrame - 1;
      return !(isLastOfFrame && dropLastLineOf.has(frameIdx));
    });

    const { assembler } = assembleStream(damaged);
    expect(assembler.stats.lostFrames).toBe(3);
  });

  it("does not report loss across the 16-bit frame-number wraparound (65535 → 0)", () => {
    const FRAMES = 10;
    const { packets } = buildTestPatternStream(FRAMES, { startFrame: 65531, height: VIC_PAL_HEIGHT });
    const { assembler, frames } = assembleStream(packets);
    // Frame numbers run 65531,65532,...,65535,0,1,2,3,4 — a clean +1 each, no phantom 65535-gap.
    expect(frames).toHaveLength(FRAMES);
    expect(assembler.stats.lostFrames).toBe(0);
  });

  it("still assembles a byte-exact frame when non-terminal packets arrive reordered within the frame", () => {
    const frameNum = 77;
    const frame = testPatternFrame(frameNum);
    const { packets } = packetizeVicFrame(frame, frameNum, VIC_PAL_HEIGHT, 0);
    // Realistic jitter: the line packets arrive out of order, but the last-line packet is still last
    // (the assembler completes ON the last-line flag, so it must arrive after its siblings). Since the
    // assembler writes each payload at its line offset, the completed frame is still byte-exact.
    const reordered = [...packets.slice(0, -1).reverse(), packets[packets.length - 1]];
    const { frames } = assembleStream(reordered);
    expect(frames).toHaveLength(1);
    expect(firstFrameMismatch(frames[0], frameNum, VIC_PAL_HEIGHT)).toBe(-1);
  });

  it("frameSeqDiff is wrap-safe (matches c64stream's int16 frame-diff)", () => {
    expect(frameSeqDiff(1, 0)).toBe(1);
    expect(frameSeqDiff(0, 65535)).toBe(1); // wrap: clean +1, not -65535
    expect(frameSeqDiff(65535, 0)).toBe(-1); // reorder / late frame
    expect(frameSeqDiff(5, 2)).toBe(3); // a 2-frame gap
  });
});
