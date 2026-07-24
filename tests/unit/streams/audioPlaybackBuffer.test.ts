/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { AudioPlaybackBuffer } from "@/lib/streams/audioPlaybackBuffer";
import { AUDIO_TIMELINE_FRAMES_PER_PACKET, AUDIO_TIMELINE_PACKET_BYTES } from "@/lib/streams/audioTimeline";

const dcBody = (value: number): Uint8Array => {
  const out = new Uint8Array(AUDIO_TIMELINE_PACKET_BYTES);
  const view = new DataView(out.buffer);
  for (let i = 0; i < AUDIO_TIMELINE_FRAMES_PER_PACKET; i++) {
    view.setInt16(i * 4, value, true);
    view.setInt16(i * 4 + 2, value, true);
  }
  return out;
};

const toInt16 = (body: Uint8Array): number[] => {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const out: number[] = [];
  for (let i = 0; i < body.length >> 1; i++) out.push(view.getInt16(i * 2, true));
  return out;
};

const maxStep = (bodies: Uint8Array[]): number => {
  const merged = bodies.flatMap(toInt16);
  let peak = 0;
  for (let i = 2; i < merged.length; i++) peak = Math.max(peak, Math.abs(merged[i] - merged[i - 2]));
  return peak;
};

const collect = (delayMs: number) => {
  const emitted: Uint8Array[] = [];
  const buffer = new AudioPlaybackBuffer({ delayMs, emit: (b) => emitted.push(b) });
  return { buffer, emitted };
};

describe("AudioPlaybackBuffer", () => {
  it("passes contiguous packets straight through with no buffering (delay 0)", () => {
    const { buffer, emitted } = collect(0);
    buffer.push(0, dcBody(100), 0);
    buffer.push(1, dcBody(100), 4);
    buffer.push(2, dcBody(100), 8);
    expect(emitted).toHaveLength(3);
    expect(buffer.stats.packetsLost).toBe(0);
  });

  it("reorders a late packet that arrives within the buffer delay", () => {
    const { buffer, emitted } = collect(5);
    // seq 1 arrives before seq 0 (reordered), both within the 5 ms window.
    buffer.push(1, dcBody(11), 0);
    buffer.push(0, dcBody(22), 2);
    // A later packet advances the wire clock past the delay, draining 0 then 1 in order.
    buffer.push(2, dcBody(33), 7);
    expect(emitted.map((b) => toInt16(b)[0])).toEqual([22, 11]); // seq 0 (val 22) then seq 1 (val 11)
    expect(buffer.stats.lateDropped).toBe(0); // the reordered packet was NOT dropped
    buffer.drainAll();
    expect(emitted.map((b) => toInt16(b)[0])).toEqual([22, 11, 33]);
  });

  it("conceals a single-packet gap with a continuous, click-free splice", () => {
    const { buffer, emitted } = collect(0);
    buffer.push(0, dcBody(4000), 0);
    buffer.push(2, dcBody(4000), 4); // seq 1 lost
    // One concealment packet + the real packet 2.
    expect(emitted).toHaveLength(3);
    expect(buffer.stats.packetsLost).toBe(1);
    expect(buffer.stats.concealed).toBe(1);
    // The concealed span keeps the signal continuous (no click) either side.
    expect(maxStep(emitted)).toBeLessThan(600);
    // Concealment fill must not be silence for a held DC level.
    expect(toInt16(emitted[1])[0]).toBeGreaterThan(3000);
  });

  it("caps concealment so a long gap does not inject unbounded audio", () => {
    const { buffer, emitted } = collect(0);
    buffer.push(0, dcBody(2000), 0); // 1 real
    buffer.push(60, dcBody(2000), 4); // 59-packet gap → capped at CONCEAL_MAX (25) fill + 1 real
    // 1 + 25 + 1 = 27, NOT 1 + 59 + 1 — a long outage does not inject 59 packets of audio.
    expect(emitted.length).toBe(27);
    expect(buffer.stats.packetsLost).toBe(59);
  });

  it("drops a duplicate packet (no double playback)", () => {
    const { buffer, emitted } = collect(0);
    buffer.push(0, dcBody(1), 0);
    buffer.push(1, dcBody(2), 4);
    buffer.push(1, dcBody(2), 8); // duplicate seq
    expect(emitted).toHaveLength(2);
    expect(buffer.stats.duplicates).toBe(1);
  });

  it("drainAll flushes the buffered tail on stop", () => {
    const { buffer, emitted } = collect(5);
    buffer.push(0, dcBody(7), 0);
    buffer.push(1, dcBody(7), 1); // both still within the delay window
    expect(emitted).toHaveLength(0);
    buffer.drainAll();
    expect(emitted).toHaveLength(2);
  });

  it("never grows the queue without bound when a low sequence stays missing", () => {
    const { buffer, emitted } = collect(5);
    // seq 0 never arrives; a long run of higher seqs must still flow (bounded queue).
    for (let seq = 1; seq < 40; seq++) buffer.push(seq, dcBody(500), seq * 4);
    expect(emitted.length).toBeGreaterThan(20);
  });

  it("reset clears the queue, stats and concealment endpoint", () => {
    const { buffer, emitted } = collect(0);
    buffer.push(0, dcBody(9), 0);
    buffer.push(5, dcBody(9), 4);
    buffer.reset();
    emitted.length = 0;
    buffer.push(100, dcBody(9), 0);
    expect(emitted).toHaveLength(1);
    expect(buffer.stats.packetsLost).toBe(0);
  });
});
