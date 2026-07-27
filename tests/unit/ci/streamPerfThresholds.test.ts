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

/**
 * Guards the committed streaming performance thresholds (spec §16/§21): the config must stay
 * well-formed and internally consistent, and the hard latency gate must not be silently widened
 * above the spec's 30 ms budget. A malformed or weakened config fails the build here.
 */
describe("committed stream perf thresholds", () => {
  const cfg = JSON.parse(readFileSync(resolve(process.cwd(), "ci/perf/stream-perf-thresholds.json"), "utf8"));

  it("carries the full measurement metadata the spec requires (§16)", () => {
    for (const section of ["latencyDrift", "hostBenchmark", "deviceCpu"]) {
      expect(cfg[section]).toBeTruthy();
      expect(typeof cfg[section].profile).toBe("string");
      expect(typeof cfg[section].runner).toBe("string");
      expect(typeof cfg[section].aggregation).toBe("string");
      expect(cfg[section].thresholds).toBeTruthy();
    }
  });

  it("keeps the hard latency budget at or below the spec's 30 ms and a consistent window structure", () => {
    const d = cfg.latencyDrift.thresholds;
    expect(d.maxRollingP99Ms).toBeLessThanOrEqual(30); // §16.1 — never widened past the budget
    expect(d.rollingWindowMs).toBe(60000); // one-minute rolling window (§7)
    expect(d.compareWindowMs).toBe(300000); // five-minute end windows (§7)
    expect(d.maxWindowDeltaMs).toBeLessThanOrEqual(2); // §7 — final 5-min p99 within 2 ms of the first
    expect(d.maxSlopeMsPerMin).toBeGreaterThan(0);
  });

  it("carries reframed end-to-end latency budgets that are ambitious but achievable (§16.1)", () => {
    const e = cfg.endToEnd.thresholds;
    // Reframed from the impossible 30 ms source→display floor to measured-on-hardware budgets. They
    // must stay above the measured values (achievable) yet tight enough to gate regressions.
    expect(e.avOffsetP99Ms).toBeGreaterThan(0);
    expect(e.avOffsetP99Ms).toBeLessThanOrEqual(20); // A/V sync measured ~2–5 ms
    expect(e.audioInputToHearP99Ms).toBeLessThanOrEqual(150); // press→hear measured ~83–87 ms
    expect(e.videoInputToDisplayP99Ms).toBeLessThanOrEqual(300); // press→see measured ~99–168 ms
    expect(e.videoInputToDisplayP99Ms).toBeGreaterThan(e.audioInputToHearP99Ms);
  });

  it("gates the native low-latency audio buffer below the WebAudio baseline", () => {
    const p = cfg.audioPlaybackLatency;
    expect(p).toBeTruthy();
    // The HIL underrun gate is a regression-flood catch, not the ideal (that is the deterministic
    // host audioContinuity gate = 0); it must stay a small, bounded tolerance.
    expect(p.thresholds.audioUnderrunsMax).toBeGreaterThan(0);
    expect(p.thresholds.audioUnderrunsMax).toBeLessThanOrEqual(30);
    // The native buffer must stay well under the measured WebAudio depth (its whole point) …
    expect(p.thresholds.nativeAudioBufferMaxMs).toBeLessThan(p.measured.webAudioBufferMs);
    // … and the recorded native measurement must sit under its own gate with headroom.
    expect(p.measured.nativeAudioBufferMs).toBeLessThanOrEqual(p.thresholds.nativeAudioBufferMaxMs);
    // A real reduction, not a rounding win: at least ~1.5x lower than WebAudio.
    expect(p.measured.nativeAudioBufferMs * 1.5).toBeLessThanOrEqual(p.measured.webAudioBufferMs);
  });

  it("keeps the zero-tolerance audio + video gates at zero (§16.2/§16.3)", () => {
    const a = cfg.audioContinuity.thresholds;
    expect(a.audioCallbackUnderruns).toBe(0);
    expect(a.applicationInducedAudioLoss).toBe(0);
    expect(a.unexplainedAudioGaps).toBe(0);
    expect(a.staleSessionAudioSamples).toBe(0);
    expect(cfg.videoSlots.thresholds.unexplainedMissingPresentationSlots).toBe(0);
  });

  /**
   * The host benchmark runs on a shared public runner, where interference is not
   * uniform: it can stall ONE stage while the others run clean, which no
   * cross-stage normalisation can cancel. `governor tick` measured 256,743 ops/s
   * in CI against a 576,956 baseline — on a runner the same run rated 19% FASTER
   * overall — while the same commit measured 552k/574k/574k locally, on code
   * that never touched the governor.
   *
   * Aggregating the repeats by their MAXIMUM is what makes that survivable, and
   * it follows from a fact the script already states: interference only ever
   * makes a microbenchmark slower, never faster. A median lets two unlucky
   * samples out of three fail the build; the best sample is the cleanest
   * measurement the machine produced. A genuine regression still fails, because
   * slower code has no fast run for the maximum to find.
   */
  it("aggregates benchmark repeats by their best sample, not their median", () => {
    const script = readFileSync(resolve(process.cwd(), "scripts/assert-stream-perf.mjs"), "utf8");
    expect(script).toMatch(/current\[name\] = Math\.round\(Math\.max\(\.\.\.values\)\)/);
    expect(script).not.toMatch(/current\[name\] = Math\.round\(median\(values\)\)/);
  });

  it("still normalises away a uniformly slower runner", () => {
    // Shape, not absolute throughput: a runner half as fast shifts every stage
    // equally, and dividing by the median per-stage ratio cancels it. Without
    // this the gate is an absolute CPU gate in disguise, which §14.3 says a
    // shared runner cannot support.
    const script = readFileSync(resolve(process.cwd(), "scripts/assert-stream-perf.mjs"), "utf8");
    expect(script).toMatch(/const scale = median\(shared\.map\(/);
  });
});
