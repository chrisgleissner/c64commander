/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { MAX_BUCKETS, StreamTelemetry, type StreamTelemetrySample } from "@/lib/streams/streamTelemetry";

/** A zeroed cumulative sample at time `tMs`; override individual fields per tick. */
const sample = (tMs: number, over: Partial<StreamTelemetrySample> = {}): StreamTelemetrySample => ({
  tMs,
  audioConcealed: 0,
  audioLostPackets: 0,
  audioBufferMs: 80,
  audioUnderruns: 0,
  videoPresented: 0,
  videoDecimated: 0,
  videoBacklogReplacements: 0,
  videoFramesLost: 0,
  videoDroppedPackets: 0,
  renderResidenceMs: 0,
  fps: 50,
  effectiveDivisor: 1,
  requestedMode: "auto",
  ...over,
});

describe("StreamTelemetry — per-second rate buckets", () => {
  it("derives per-second deltas from cumulative counters", () => {
    const t = new StreamTelemetry();
    // Second 0: presented climbs 0 → 50, concealed 0 → 3.
    t.record(sample(0, { videoPresented: 0, audioConcealed: 0 }));
    t.record(sample(500, { videoPresented: 25, audioConcealed: 1 }));
    t.record(sample(900, { videoPresented: 50, audioConcealed: 3 }));
    // Roll into second 1 to close the second-0 bucket.
    t.record(sample(1000, { videoPresented: 50, audioConcealed: 3 }));

    const window = t.buffersWindow(MAX_BUCKETS);
    const sec0 = window.find((b) => b.sec === 0)!;
    expect(sec0.presentedPerSec).toBe(50);
    expect(sec0.concealedPerSec).toBe(3);
    expect(sec0.fpsAvg).toBeCloseTo(50, 5);
  });

  it("tracks the minimum audio buffer depth within a second", () => {
    const t = new StreamTelemetry();
    t.record(sample(0, { audioBufferMs: 80 }));
    t.record(sample(300, { audioBufferMs: 20 }));
    t.record(sample(700, { audioBufferMs: 55 }));
    t.record(sample(1000)); // close second 0
    const sec0 = t.buffersWindow(MAX_BUCKETS).find((b) => b.sec === 0)!;
    expect(sec0.audioBufferMsMin).toBe(20);
  });

  it("counts underruns occurring within a second", () => {
    const t = new StreamTelemetry();
    t.record(sample(0, { audioUnderruns: 0 }));
    t.record(sample(400, { audioUnderruns: 2 }));
    t.record(sample(1000, { audioUnderruns: 2 })); // close second 0
    const sec0 = t.buffersWindow(MAX_BUCKETS).find((b) => b.sec === 0)!;
    expect(sec0.underrunsInSec).toBe(2);
  });
});

describe("StreamTelemetry — bounded history", () => {
  it("never retains more than MAX_BUCKETS one-second buckets", () => {
    const t = new StreamTelemetry();
    for (let s = 0; s < MAX_BUCKETS + 200; s++) t.record(sample(s * 1000 + 1, { videoPresented: s * 50 }));
    // One extra sample to close the final bucket.
    t.record(sample((MAX_BUCKETS + 200) * 1000 + 1));
    const all = t.buffersWindow(Number.MAX_SAFE_INTEGER);
    expect(all.length).toBeLessThanOrEqual(MAX_BUCKETS + 1); // + the still-open bucket
  });

  it("windows history to the requested number of seconds", () => {
    const t = new StreamTelemetry();
    for (let s = 0; s < 120; s++) t.record(sample(s * 1000 + 1));
    t.record(sample(120 * 1000 + 1)); // close second 119
    const last60 = t.buffersWindow(60);
    expect(last60.length).toBeLessThanOrEqual(61);
    expect(last60.every((b) => b.sec > 120 - 60 - 1)).toBe(true);
  });
});

describe("StreamTelemetry — session summary", () => {
  it("summarises totals, extremes and residence percentiles", () => {
    const t = new StreamTelemetry();
    for (let i = 0; i <= 100; i++) {
      t.record(
        sample(i * 100, {
          videoPresented: i,
          audioUnderruns: i >= 50 ? 1 : 0,
          audioBufferMs: 80 - (i % 10),
          renderResidenceMs: i, // 0..100 → p99 ≈ 99
          fps: 50,
        }),
      );
    }
    const s = t.summary();
    expect(s.videoPresented).toBe(100);
    expect(s.audioUnderruns).toBe(1);
    expect(s.audioBufferMsMin).toBe(71);
    expect(s.residence.p99).toBeGreaterThan(90);
    expect(s.residence.max).toBe(100);
    expect(s.durationMs).toBe(10000);
    expect(s.fpsMax).toBe(50);
  });

  it("export() is a bounded, self-describing JSON-able payload", () => {
    const t = new StreamTelemetry();
    for (let i = 0; i < 10; i++) t.record(sample(i * 1000 + 1, { videoPresented: i * 50 }));
    const payload = t.export({ appVersion: "0.8.8", device: "test" });
    expect(payload.appVersion).toBe("0.8.8");
    expect(payload).toHaveProperty("summary");
    expect(payload).toHaveProperty("buckets");
    expect(payload).toHaveProperty("metricConventions");
    // Must round-trip through JSON (no functions / circular refs).
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it("reset() clears all history and summary state", () => {
    const t = new StreamTelemetry();
    for (let i = 0; i < 5; i++) t.record(sample(i * 1000 + 1, { videoPresented: i * 10 }));
    t.reset();
    expect(t.buffersWindow(MAX_BUCKETS)).toHaveLength(0);
    expect(t.summary().samples).toBe(0);
    expect(t.summary().videoPresented).toBe(0);
  });
});
