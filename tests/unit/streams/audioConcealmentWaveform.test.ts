/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AudioPlaybackBuffer } from "@/lib/streams/audioPlaybackBuffer";
import { AUDIO_TIMELINE_FRAMES_PER_PACKET, AUDIO_TIMELINE_PACKET_BYTES } from "@/lib/streams/audioTimeline";

/**
 * Audio packet-loss concealment — WAVEFORM analysis (spec §8.1). Rather than assert on logs, this
 * reconstructs the concealed output waveform for a matrix of deterministic fixtures and asserts:
 *   - exact output sample count (no timeline gaps),
 *   - concealment adds no click larger than the committed threshold OR the signal's own step,
 *   - concealment counters match the loss timeline,
 *   - deterministic output for deterministic input,
 *   - bounded recovery after a loss burst.
 */

const FRAMES = AUDIO_TIMELINE_FRAMES_PER_PACKET; // 192 stereo frames per packet
const MAX_CLICK = JSON.parse(readFileSync(resolve(process.cwd(), "ci/perf/stream-perf-thresholds.json"), "utf8"))
  .audioConcealmentClick.thresholds.maxClickStep as number;

type Wave = (frame: number) => [number, number];

/** SID output is DC-biased — none of these fixtures sit at 0 (a zero-fill against a DC signal clicks). */
const fixtures: Record<string, Wave> = {
  tone440: (f) => [
    Math.round(6000 * Math.sin((2 * Math.PI * 440 * f) / 48000) + 800),
    Math.round(6000 * Math.sin((2 * Math.PI * 440 * f) / 48000) + 800),
  ],
  silenceDcBias: () => [1500, -1200],
  impulseTrain: (f) => (f % 512 === 0 ? [12000, 12000] : [1000, 1000]),
  square1k: (f) => (Math.floor((2 * 1000 * f) / 48000) % 2 === 0 ? [8000, -8000] : [-8000, 8000]),
  noteLadder: (f) => {
    const step = Math.floor(f / 512) % 8;
    const freq = 220 * Math.pow(2, step / 12);
    const v = Math.round(5000 * Math.sin((2 * Math.PI * freq * f) / 48000) + 600);
    return [v, v];
  },
  speechLike: (f) => {
    const carrier = Math.sin((2 * Math.PI * 300 * f) / 48000);
    const envelope = 0.5 + 0.5 * Math.sin((2 * Math.PI * 5 * f) / 48000);
    const v = Math.round(7000 * carrier * envelope + 400);
    return [v, v];
  },
  highFreq: (f) => {
    const v = Math.round(5000 * Math.sin((2 * Math.PI * 20000 * f) / 48000) + 300);
    return [v, v];
  },
};

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, v));

/** Build a source stream of `packets` PCM bodies (768 bytes each) from a fixture. */
const buildSource = (wave: Wave, packets: number): Uint8Array[] => {
  const bodies: Uint8Array[] = [];
  for (let p = 0; p < packets; p++) {
    const body = new Uint8Array(AUDIO_TIMELINE_PACKET_BYTES);
    const view = new DataView(body.buffer);
    for (let i = 0; i < FRAMES; i++) {
      const [l, r] = wave(p * FRAMES + i);
      view.setInt16(i * 4, clamp16(l), true);
      view.setInt16(i * 4 + 2, clamp16(r), true);
    }
    bodies.push(body);
  }
  return bodies;
};

interface ConcealResult {
  samples: Int16Array; // interleaved L,R for the whole reconstructed output
  concealed: number;
  packetsLost: number;
}

/** Feed the source (dropping `drop` seq indices) through the PLC buffer and reconstruct the output. */
const runConceal = (source: Uint8Array[], drop: Set<number>): ConcealResult => {
  const emitted: Uint8Array[] = [];
  const buffer = new AudioPlaybackBuffer({ delayMs: 0, emit: (body) => emitted.push(body.slice()) });
  let clock = 0;
  source.forEach((body, seq) => {
    clock += 4; // ~4 ms/packet wire cadence
    if (!drop.has(seq)) buffer.push(seq, body, clock);
  });
  buffer.drainAll();
  const total = emitted.reduce((n, b) => n + b.length, 0) / 2;
  const samples = new Int16Array(total);
  let o = 0;
  for (const b of emitted) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < b.length; i += 2) samples[o++] = v.getInt16(i, true);
  }
  return { samples, concealed: buffer.stats.concealed, packetsLost: buffer.stats.packetsLost };
};

/** Max absolute step between consecutive SAME-channel samples (interleaved → stride 2). */
const maxStep = (samples: Int16Array): number => {
  let peak = 0;
  for (let i = 2; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i] - samples[i - 2]));
  return peak;
};

describe("audio concealment — waveform fixtures (§8.1)", () => {
  for (const [name, wave] of Object.entries(fixtures)) {
    it(`${name}: isolated single-packet loss adds no click beyond the signal's own steps, no gap`, () => {
      const source = buildSource(wave, 40);
      const clean = runConceal(source, new Set());
      const lossy = runConceal(source, new Set([20]));

      // No timeline gap: the concealed output has the SAME sample count as the clean output (the
      // missing packet is filled, not dropped). Both cover all 40 packets.
      expect(lossy.samples.length).toBe(clean.samples.length);
      expect(lossy.samples.length).toBe(40 * FRAMES * 2);

      // The concealed splice adds no discontinuity larger than the committed click threshold OR the
      // fixture's own maximum step (square/impulse/high-freq legitimately step hard).
      const sourceStep = maxStep(clean.samples);
      expect(maxStep(lossy.samples)).toBeLessThanOrEqual(Math.max(MAX_CLICK, sourceStep));

      // Exactly one packet concealed.
      expect(lossy.packetsLost).toBe(1);
      expect(lossy.concealed).toBe(1);
    });
  }

  it("tone: a 5-packet burst loss is concealed with bounded recovery and no gap", () => {
    const source = buildSource(fixtures.tone440, 60);
    const clean = runConceal(source, new Set());
    const drop = new Set([25, 26, 27, 28, 29]);
    const lossy = runConceal(source, drop);

    expect(lossy.samples.length).toBe(clean.samples.length); // no gap — the burst is filled
    expect(lossy.packetsLost).toBe(5);
    expect(lossy.concealed).toBe(5);
    // Recovery: after the burst, the tail (last 10 packets) matches the clean output exactly (the
    // timeline re-locked, no lingering artefact).
    const tail = 10 * FRAMES * 2;
    const a = clean.samples.subarray(clean.samples.length - tail);
    const b = lossy.samples.subarray(lossy.samples.length - tail);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("is deterministic: identical input + loss pattern → byte-identical concealed output", () => {
    const source = buildSource(fixtures.speechLike, 30);
    const drop = new Set([10, 11, 20]);
    const a = runConceal(source, drop);
    const b = runConceal(source, drop);
    expect(Array.from(b.samples)).toEqual(Array.from(a.samples));
  });

  it("silence (DC bias): concealment never zero-fills a DC-biased signal (that would itself click)", () => {
    const source = buildSource(fixtures.silenceDcBias, 20);
    const lossy = runConceal(source, new Set([10]));
    // The held/faded region must stay near the DC bias, never snapping to 0 — the max step stays tiny.
    expect(maxStep(lossy.samples)).toBeLessThan(MAX_CLICK);
    expect(lossy.concealed).toBe(1);
  });
});
