/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  AUDIO_CONCEAL_FADE_SAMPLES,
  AUDIO_RESYNC_THRESHOLD,
  AUDIO_TIMELINE_FRAMES_PER_PACKET,
  AUDIO_TIMELINE_PACKET_BYTES,
  AudioTimeline,
  concealFillPacket,
} from "@/lib/streams/audioTimeline";

/** A 768-byte packet body of constant DC (left, right) — mimics a held SID output level. */
const dcBody = (left: number, right = left): Uint8Array => {
  const out = new Uint8Array(AUDIO_TIMELINE_PACKET_BYTES);
  const view = new DataView(out.buffer);
  for (let i = 0; i < AUDIO_TIMELINE_FRAMES_PER_PACKET; i++) {
    view.setInt16(i * 4, left, true);
    view.setInt16(i * 4 + 2, right, true);
  }
  return out;
};

const toInt16 = (body: Uint8Array): Int16Array => {
  const out = new Int16Array(body.length >> 1);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
};

/** Largest absolute step between consecutive (same-channel) samples across a body sequence. */
const maxStep = (...bodies: Uint8Array[]): number => {
  const merged = bodies.flatMap((b) => Array.from(toInt16(b)));
  let peak = 0;
  for (let i = 2; i < merged.length; i++) peak = Math.max(peak, Math.abs(merged[i] - merged[i - 2]));
  return peak;
};

describe("AudioTimeline.advance", () => {
  it("plays the first packet, then contiguous packets", () => {
    const tl = new AudioTimeline();
    expect(tl.advance(100)).toEqual({ action: "play", index: 0, gap: 0 });
    expect(tl.advance(101)).toEqual({ action: "play", index: 1, gap: 0 });
    expect(tl.advance(102)).toEqual({ action: "play", index: 2, gap: 0 });
  });

  it("drops a duplicate and a late packet without advancing the index", () => {
    const tl = new AudioTimeline();
    tl.advance(100);
    tl.advance(101);
    expect(tl.advance(101)).toMatchObject({ action: "drop", index: 1 }); // duplicate
    expect(tl.advance(99)).toMatchObject({ action: "drop", index: 1 }); // late (backward, small)
    expect(tl.stats.duplicates).toBe(1);
    expect(tl.stats.lateDropped).toBe(1);
    // A subsequent contiguous packet still advances from the last PLAYED seq (101).
    expect(tl.advance(102)).toEqual({ action: "play", index: 2, gap: 0 });
  });

  it("conceals a forward gap and advances the index by the true delta (A/V sync preserved)", () => {
    const tl = new AudioTimeline();
    tl.advance(100);
    const r = tl.advance(104); // 3-packet gap (101,102,103 missing)
    expect(r).toEqual({ action: "conceal", index: 4, gap: 3 });
    expect(tl.stats.packetsLost).toBe(3);
    expect(tl.stats.concealed).toBe(3);
  });

  it("handles 16-bit sequence wraparound", () => {
    const tl = new AudioTimeline();
    tl.advance(65534);
    expect(tl.advance(65535)).toMatchObject({ action: "play" });
    expect(tl.advance(0)).toMatchObject({ action: "play" }); // 65535 -> 0 is +1
    expect(tl.advance(2)).toMatchObject({ action: "conceal", gap: 1 }); // 0 -> 2 gap of 1
  });

  it("resyncs on a large backward jump (device restart)", () => {
    const tl = new AudioTimeline();
    tl.advance(5000);
    const r = tl.advance(5000 - AUDIO_RESYNC_THRESHOLD - 5);
    expect(r.action).toBe("resync");
    expect(tl.stats.resyncs).toBe(1);
  });

  it("resyncs on a forward jump beyond the fill cap", () => {
    const tl = new AudioTimeline();
    tl.advance(1);
    const r = tl.advance(3000); // > WAV_FILL_MAX (1250)
    expect(r.action).toBe("resync");
  });

  it("resets to a clean slate", () => {
    const tl = new AudioTimeline();
    tl.advance(10);
    tl.advance(20);
    tl.reset();
    expect(tl.stats.packetsLost).toBe(0);
    expect(tl.advance(999)).toEqual({ action: "play", index: 0, gap: 0 });
  });
});

describe("concealFillPacket — step-free, DC-safe, fades to silence", () => {
  it("keeps a steady-level gap step-free (no click) between the real packets either side", () => {
    // A held SID level of +5000 either side of a single lost packet.
    const last = dcBody(5000);
    const next = dcBody(5000);
    const fill = concealFillPacket({ lastLeft: 5000, lastRight: 5000, nextLeft: 5000, nextRight: 5000 }, 0, 1);
    // The entire concealed span sits at ~5000 — the largest sample step stays far below the
    // ~600-count click-detector threshold that c64stream calibrates against.
    expect(maxStep(last, fill, next)).toBeLessThan(600);
  });

  it("splices a full-scale polarity flip across the gap without a click", () => {
    // Worst case: +8000 before the gap, -8000 after — the ramp must bridge it smoothly.
    const last = dcBody(8000);
    const next = dcBody(-8000);
    const fill = concealFillPacket({ lastLeft: 8000, lastRight: 8000, nextLeft: -8000, nextRight: -8000 }, 0, 1);
    expect(maxStep(last, fill, next)).toBeLessThan(600);
    // Exit sample must land exactly on the next real packet's first sample (step-free exit).
    const filled = toInt16(fill);
    expect(filled[filled.length - 2]).toBe(-8000); // last left
    expect(filled[filled.length - 1]).toBe(-8000); // last right
  });

  it("never zero-fills a DC-biased signal on the entry splice (that would itself click)", () => {
    // First concealed sample must equal the last real sample, NOT drop to 0.
    const fill = concealFillPacket({ lastLeft: 6000, lastRight: 6000, nextLeft: 6000, nextRight: 6000 }, 0, 4);
    const filled = toInt16(fill);
    expect(filled[0]).toBe(6000);
    expect(filled[1]).toBe(6000);
  });

  it("fades a long gap toward silence rather than freezing on a DC plateau", () => {
    // Beyond FADE_SAMPLES (~100 ms) the held value has decayed to 0.
    const packetsToSilence = Math.ceil(AUDIO_CONCEAL_FADE_SAMPLES / AUDIO_TIMELINE_FRAMES_PER_PACKET);
    const gap = packetsToSilence + 2;
    const farPacket = concealFillPacket(
      { lastLeft: 8000, lastRight: 8000, nextLeft: 0, nextRight: 0 },
      packetsToSilence + 1,
      gap,
    );
    const filled = toInt16(farPacket);
    expect(Math.max(...Array.from(filled).map(Math.abs))).toBe(0);
  });

  it("zero-fills defensively on an out-of-range index", () => {
    const fill = concealFillPacket({ lastLeft: 1, lastRight: 1, nextLeft: 1, nextRight: 1 }, 5, 3);
    expect(Array.from(toInt16(fill)).every((s) => s === 0)).toBe(true);
  });
});
