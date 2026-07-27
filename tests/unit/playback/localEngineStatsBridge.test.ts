/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { LocalEngineStatsAccumulator } from "@/lib/playback/localEngineStatsBridge";

describe("LocalEngineStatsAccumulator", () => {
  it("passes the session render p99 straight through", () => {
    const accumulator = new LocalEngineStatsAccumulator();
    expect(accumulator.sample({ renderMsPerSecP99: 120, audioUnderruns: 0 }).renderMsPerSec).toBe(120);
    // The p99 may fall as more good samples arrive — report it, don't ratchet.
    expect(accumulator.sample({ renderMsPerSecP99: 90, audioUnderruns: 0 }).renderMsPerSec).toBe(90);
  });

  it("banks underruns across tunes when the per-tune counter restarts", () => {
    const accumulator = new LocalEngineStatsAccumulator();
    const p99 = { renderMsPerSecP99: 100 };

    // First tune accumulates two underruns.
    expect(accumulator.sample({ ...p99, audioUnderruns: 1 }).audioUnderruns).toBe(1);
    expect(accumulator.sample({ ...p99, audioUnderruns: 2 }).audioUnderruns).toBe(2);

    // Auto-advance rebuilds the scheduler, so the counter drops back to 0.
    // The finished tune's two underruns must not be lost.
    expect(accumulator.sample({ ...p99, audioUnderruns: 0 }).audioUnderruns).toBe(2);
    expect(accumulator.sample({ ...p99, audioUnderruns: 3 }).audioUnderruns).toBe(5);

    // A third tune banks the second tune's three.
    expect(accumulator.sample({ ...p99, audioUnderruns: 1 }).audioUnderruns).toBe(6);
  });

  it("stays at zero across a clean multi-tune soak", () => {
    const accumulator = new LocalEngineStatsAccumulator();
    for (let tune = 0; tune < 30; tune += 1) {
      for (let poll = 0; poll < 5; poll += 1) {
        expect(accumulator.sample({ renderMsPerSecP99: 80, audioUnderruns: 0 }).audioUnderruns).toBe(0);
      }
    }
  });

  it("resets for a fresh measurement session", () => {
    const accumulator = new LocalEngineStatsAccumulator();
    accumulator.sample({ renderMsPerSecP99: 100, audioUnderruns: 4 });
    accumulator.sample({ renderMsPerSecP99: 100, audioUnderruns: 0 });
    expect(accumulator.sample({ renderMsPerSecP99: 100, audioUnderruns: 1 }).audioUnderruns).toBe(5);

    accumulator.reset();
    expect(accumulator.sample({ renderMsPerSecP99: 100, audioUnderruns: 1 }).audioUnderruns).toBe(1);
  });
});
