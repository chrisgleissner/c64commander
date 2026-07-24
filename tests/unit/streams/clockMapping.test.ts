/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { fitClockMapping, mapSourceToDevice, canAssertBelow, type ClockPair } from "@/lib/streams/clockMapping";

describe("clock mapping (§5.1)", () => {
  it("recovers a known offset + drift and reports a residual bounded by the noise", () => {
    const offset = 1234;
    const driftPpm = 40; // 40 ppm clock skew
    const scale = 1 + driftPpm / 1e6;
    const noise = 0.3; // ±0.3 ms deterministic sawtooth noise
    const pairs: ClockPair[] = [];
    for (let i = 0; i < 200; i++) {
      const sourceMs = i * 1000;
      const deviceMs = scale * sourceMs + offset + (i % 2 === 0 ? noise : -noise);
      pairs.push({ sourceMs, deviceMs });
    }
    const m = fitClockMapping(pairs);
    expect(m.offsetMs).toBeCloseTo(offset, 0);
    expect(m.driftPpm).toBeCloseTo(driftPpm, 0);
    // The residual is bounded by ~the noise amplitude (the OLS fit leaves a hair more at the ends).
    expect(m.residualMaxMs).toBeLessThanOrEqual(noise * 1.1);
    expect(m.residualStdMs).toBeLessThanOrEqual(noise);
    // The mapping round-trips a source time to the device clock within the residual.
    expect(mapSourceToDevice(50_000, m)).toBeCloseTo(scale * 50_000 + offset, 1);
  });

  it("reports unknown (infinite) uncertainty when there are too few pairs to establish drift", () => {
    expect(fitClockMapping([]).residualMaxMs).toBe(Infinity);
    expect(fitClockMapping([{ sourceMs: 0, deviceMs: 5 }]).residualMaxMs).toBe(Infinity);
  });

  it("only asserts a latency gate when the uncertainty is small enough to distinguish it (§5.1)", () => {
    // Clearly below, tight uncertainty → pass.
    expect(canAssertBelow({ valueMs: 20, uncertaintyMs: 1 }, 30)).toBe("pass");
    // Clearly above → fail.
    expect(canAssertBelow({ valueMs: 40, uncertaintyMs: 1 }, 30)).toBe("fail");
    // Value near the threshold within the error band → inconclusive.
    expect(canAssertBelow({ valueMs: 29.5, uncertaintyMs: 1 }, 30)).toBe("inconclusive");
    // Uncertainty too large to distinguish the threshold → inconclusive (never a false "proven").
    expect(canAssertBelow({ valueMs: 20, uncertaintyMs: 5 }, 30)).toBe("inconclusive");
    expect(canAssertBelow({ valueMs: 20, uncertaintyMs: Infinity }, 30)).toBe("inconclusive");
  });
});
