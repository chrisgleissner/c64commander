/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VideoMirrorController } from "@/lib/streams/videoMirrorController";
import type { StreamConnectionState, StreamReceiver } from "@/lib/streams/streamReceiver";
import { analyzeLatencyDrift, type DriftThresholds, type LatencySample } from "@/lib/streams/latencyDrift";
import { VIC_HEADER_BYTES, VIC_BYTES_PER_LINE, VIC_LAST_LINE_FLAG } from "@/lib/streams/vicStream";
import { VIC_FRAME_WIDTH } from "@/lib/streams/vicDecode";

/**
 * Deterministic no-drift soak (spec §7, §14.6). Runs the real VideoMirrorController over ~11 minutes
 * of VIRTUAL time (accelerated) and proves the present-queue residence does not trend upward, using
 * the committed thresholds. Also proves the drift gate has teeth: a genuinely drifting series fails.
 */

// Load the committed thresholds (§16) — the same file CI asserts against. Resolved from the repo
// root (vitest cwd) so it works in the jsdom environment where import.meta.url is not a file URL.
const thresholdsPath = resolve(process.cwd(), "ci/perf/stream-perf-thresholds.json");
const CONFIG = JSON.parse(readFileSync(thresholdsPath, "utf8")) as {
  latencyDrift: { durationSimulatedMs: number; thresholds: DriftThresholds };
};
const DRIFT: DriftThresholds = CONFIG.latencyDrift.thresholds;

/** Small deterministic PRNG (mulberry32) so the soak is reproducible. */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

class FakeReceiver implements StreamReceiver {
  datagram: ((d: Uint8Array, t: number) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "10.0.0.5:11000";
  onDatagram(h: (d: Uint8Array, t: number) => void) {
    this.datagram = h;
  }
  onStateChange(h: (s: StreamConnectionState) => void) {
    this.stateCb = h;
  }
  close() {}
  open() {
    this.stateCb?.("open");
  }
  emit(bytes: Uint8Array, t: number) {
    this.datagram?.(bytes, t);
  }
}

const videoPacket = (seq: number, frame: number, line: number, lastLine: boolean) => {
  const p = new Uint8Array(VIC_HEADER_BYTES + VIC_BYTES_PER_LINE);
  const v = new DataView(p.buffer);
  v.setUint16(0, seq & 0xffff, true);
  v.setUint16(2, frame & 0xffff, true);
  v.setUint16(4, (line & 0x7fff) | (lastLine ? VIC_LAST_LINE_FLAG : 0), true);
  v.setUint16(6, VIC_FRAME_WIDTH, true);
  p[8] = 4;
  p[9] = 4;
  return p;
};

describe("Live View soak — no progressive latency drift (§7/§14.6)", () => {
  it("keeps present-queue residence bounded and non-drifting over ~11 virtual minutes", async () => {
    let clock = 0;
    const queued: Array<() => void> = [];
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      schedulePresent: (present) => queued.push(present),
      now: () => clock,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.open();

    const random = rng(0xc0ffee);
    const samples: LatencySample[] = [];
    // Sample at 10 Hz for the full committed soak duration + a compare window of margin.
    const totalMs = CONFIG.latencyDrift.durationSimulatedMs + DRIFT.compareWindowMs;
    let seq = 0;
    let frame = 0;
    for (let t = 0; t < totalMs; t += 100) {
      clock = t;
      // Complete one frame at this instant (enqueue → readyMs = clock).
      receiver.emit(videoPacket(seq, frame, 0, false), clock);
      receiver.emit(videoPacket(seq + 1, frame, 268, true), clock);
      seq += 2;
      frame = (frame + 1) & 0xffff;
      // A BOUNDED render latency (2–8 ms jitter) elapses before the frame is presented — the pipeline
      // must not let this accumulate. This models the local render residence, not the network.
      clock += 2 + random() * 6;
      while (queued.length) queued.shift()!();
      samples.push({ tMs: clock, latencyMs: controller.getSnapshot().renderResidenceMs });
    }

    const analysis = analyzeLatencyDrift(samples, DRIFT);
    expect(analysis.rollingWithinBudget).toBe(true); // every 1-min window p99 < 30 ms
    expect(analysis.windowDeltaWithinTolerance).toBe(true); // last 5-min p99 ≈ first 5-min p99
    expect(analysis.slopeWithinTolerance).toBe(true); // no upward regression slope
    expect(analysis.passed).toBe(true);
    // Sanity: residence really is bounded (a few ms), never near the budget.
    expect(analysis.rollingP99MaxMs).toBeLessThan(15);
  });

  it("the drift gate has teeth: a genuinely drifting latency series FAILS every check", () => {
    // Latency that climbs ~1 ms every 6 s → ~10 ms/min, well past the committed slope tolerance and
    // the first-vs-last window delta; the analysis must reject it (not silently pass).
    const drifting: LatencySample[] = [];
    for (let t = 0; t < CONFIG.latencyDrift.durationSimulatedMs; t += 100) {
      drifting.push({ tMs: t, latencyMs: 5 + t / 6000 });
    }
    const analysis = analyzeLatencyDrift(drifting, DRIFT);
    expect(analysis.slopeWithinTolerance).toBe(false);
    expect(analysis.windowDeltaWithinTolerance).toBe(false);
    expect(analysis.passed).toBe(false);
    expect(analysis.slopeMsPerMin).toBeGreaterThan(DRIFT.maxSlopeMsPerMin);
  });

  it("a series that briefly breaches the budget mid-run fails the rolling-window check", () => {
    const samples: LatencySample[] = [];
    for (let t = 0; t < 600000; t += 100) {
      // Mostly ~5 ms, but a 10 s spike to 40 ms around the 5-minute mark (a transient stall).
      const spiking = t >= 300000 && t < 310000;
      samples.push({ tMs: t, latencyMs: spiking ? 40 : 5 });
    }
    const analysis = analyzeLatencyDrift(samples, DRIFT);
    expect(analysis.rollingWithinBudget).toBe(false); // the spike window exceeds the 30 ms budget
    expect(analysis.passed).toBe(false);
  });
});
