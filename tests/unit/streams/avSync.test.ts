/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { AvSyncAnalyzer, meanFrameLuma, rmsInt16 } from "@/lib/streams/avSync";

const FRAME_BYTES = (384 * 272) / 2; // packed 4bpp PAL frame
const whiteFrame = () => new Uint8Array(FRAME_BYTES).fill(0x11); // both nibbles = white (index 1)
const blackFrame = () => new Uint8Array(FRAME_BYTES); // index 0
const loud = (amp = 8000) => new Int16Array(768).fill(amp);
const silent = () => new Int16Array(768);

/** Prime the baselines/arming with a quiet, dark sample so the next pop is a clean rising edge. */
const primeIdle = (a: AvSyncAnalyzer, t: number) => {
  a.pushVideoFrame(blackFrame(), t);
  a.pushAudioSamples(silent(), t);
};

describe("meanFrameLuma / rmsInt16", () => {
  it("reads a black frame as ~0 and a white frame as bright", () => {
    expect(meanFrameLuma(blackFrame(), 7)).toBe(0);
    expect(meanFrameLuma(whiteFrame(), 7)).toBeGreaterThan(200); // white luma ≈ 231
    expect(meanFrameLuma(new Uint8Array(0), 7)).toBe(0);
  });

  it("computes RMS: silence 0, constant amplitude = that amplitude", () => {
    expect(rmsInt16(silent())).toBe(0);
    expect(rmsInt16(loud(5000))).toBeCloseTo(5000, 5);
    expect(rmsInt16(new Int16Array(0))).toBe(0);
  });
});

describe("AvSyncAnalyzer — pop detection & offset", () => {
  it("matches a video pop to the following audio pop (audio lags → positive offset)", () => {
    const a = new AvSyncAnalyzer();
    primeIdle(a, 0);
    expect(a.pushVideoFrame(whiteFrame(), 1000)).toBeNull(); // video pop, no audio yet
    a.pushVideoFrame(blackFrame(), 1010); // re-arm video
    expect(a.pushAudioSamples(loud(), 1030)).toBe(30); // audio pop → 1030 − 1000
    expect(a.getStats()).toMatchObject({ count: 1, lastMs: 30, minMs: 30, maxMs: 30, avgMs: 30 });
  });

  it("matches an audio pop to the following video pop (audio leads → negative offset)", () => {
    const a = new AvSyncAnalyzer();
    primeIdle(a, 0);
    expect(a.pushAudioSamples(loud(), 980)).toBeNull(); // audio pop, no video yet
    a.pushAudioSamples(silent(), 985); // re-arm audio
    expect(a.pushVideoFrame(whiteFrame(), 1000)).toBe(-20); // 980 − 1000
    expect(a.getStats().lastMs).toBe(-20);
  });

  it("de-bounces: a run of white frames is one pop, not many", () => {
    const a = new AvSyncAnalyzer();
    primeIdle(a, 0);
    a.pushVideoFrame(whiteFrame(), 1000);
    a.pushVideoFrame(whiteFrame(), 1001);
    a.pushVideoFrame(whiteFrame(), 1002);
    expect(a.getStats().unmatchedVideo).toBe(1);
    a.pushVideoFrame(blackFrame(), 1003); // re-arm
    a.pushVideoFrame(whiteFrame(), 1960); // next flash → a second pop
    expect(a.getStats().unmatchedVideo).toBe(2);
  });

  it("does not match pops that are further apart than the window", () => {
    const a = new AvSyncAnalyzer({ matchWindowMs: 100 });
    primeIdle(a, 0);
    a.pushVideoFrame(whiteFrame(), 1000);
    a.pushVideoFrame(blackFrame(), 1010);
    expect(a.pushAudioSamples(loud(), 1200)).toBeNull(); // 200ms apart > 100ms window
    expect(a.getStats().count).toBe(0);
    expect(a.getStats().unmatchedAudio).toBe(1);
  });

  it("drops an unmatched pop once it ages past the TTL", () => {
    const a = new AvSyncAnalyzer({ popTtlMs: 500 });
    primeIdle(a, 0);
    a.pushVideoFrame(whiteFrame(), 1000); // unmatched video pop
    a.pushVideoFrame(blackFrame(), 1010);
    expect(a.getStats().unmatchedVideo).toBe(1);
    // A later audio pop well past the TTL prunes the stale video pop and does not match it.
    expect(a.pushAudioSamples(loud(), 2000)).toBeNull();
    const stats = a.getStats();
    expect(stats.count).toBe(0);
    expect(stats.unmatchedVideo).toBe(0);
  });
});

describe("AvSyncAnalyzer — statistics", () => {
  const feedPair = (a: AvSyncAnalyzer, base: number, offsetMs: number) => {
    a.pushVideoFrame(whiteFrame(), base);
    a.pushVideoFrame(blackFrame(), base + 5);
    a.pushAudioSamples(loud(), base + offsetMs);
    a.pushAudioSamples(silent(), base + offsetMs + 5);
  };

  it("reports count/last/min/avg/max and percentiles across many pops", () => {
    const a = new AvSyncAnalyzer();
    primeIdle(a, 0);
    const offsets = [10, 20, 30, 40, 100];
    offsets.forEach((off, i) => feedPair(a, 1000 + i * 1000, off));

    const s = a.getStats();
    expect(s.count).toBe(5);
    expect(s.lastMs).toBe(100);
    expect(s.minMs).toBe(10);
    expect(s.maxMs).toBe(100);
    expect(s.avgMs).toBeCloseTo(40, 5);
    // p90 ≈ 76, p99 ≈ 97.6 for [10,20,30,40,100]
    expect(s.p90Ms).toBeGreaterThan(s.avgMs!);
    expect(s.p99Ms).toBeGreaterThanOrEqual(s.p90Ms!);
    expect(s.p99Ms).toBeLessThanOrEqual(100);
  });

  it("starts empty and resets cleanly", () => {
    const a = new AvSyncAnalyzer();
    expect(a.getStats()).toMatchObject({ count: 0, lastMs: null, minMs: null, p90Ms: null });
    primeIdle(a, 0);
    feedPair(a, 1000, 25);
    expect(a.getStats().count).toBe(1);
    a.reset();
    expect(a.getStats()).toMatchObject({ count: 0, lastMs: null, unmatchedVideo: 0, unmatchedAudio: 0 });
  });
});
