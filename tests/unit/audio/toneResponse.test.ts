/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TONE_PRESETS } from "@/lib/audio/tone/toneCurve";
import { AMBIANCE_PRESETS } from "@/lib/audio/tone/ambiancePresets";
import {
  FREQUENCIES_HZ,
  TONE_RESPONSE_POINTS,
  cascadeResponseDb,
  compensatedGains,
  reachableTargets,
  responseAtCentres,
  sampleResponse,
  solveLinear,
} from "@/lib/audio/tone/toneResponse";

const fixture = JSON.parse(readFileSync("tests/fixtures/toneResponseVectors.json", "utf8")) as {
  sampleRate: number;
  cases: { gainsDb: number[]; hz: number[]; expectedDb: number[] }[];
};

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomTargets = (count: number): number[][] => {
  const random = mulberry32(20261024);
  const vectors: number[][] = [];
  const ten = (f: (i: number) => number) => Array.from({ length: 10 }, (_, i) => f(i));
  vectors.push(
    ten(() => 0),
    ten((i) => (i % 2 ? -12 : 12)),
    ten((i) => (i % 2 ? 12 : -12)),
  );
  vectors.push(
    ten((i) => (i < 5 ? -12 : 12)),
    ten((i) => (i === 4 ? 12 : 0)),
    ten((i) => (i === 4 ? -12 : 0)),
  );
  vectors.push(
    ten(() => 12),
    ten(() => -12),
  );
  while (vectors.length < count) {
    const kind = vectors.length % 4;
    vectors.push(
      ten(() => {
        const value = (random() * 2 - 1) * 12;
        return kind === 0 ? Math.round(value) : kind === 1 ? Math.sign(value) * 12 : kind === 2 ? value / 3 : value;
      }),
    );
  }
  return vectors;
};

describe("tone response", () => {
  it("samples 240 log-spaced points from 20 Hz to 20 kHz", () => {
    expect(FREQUENCIES_HZ).toHaveLength(TONE_RESPONSE_POINTS);
    expect(FREQUENCIES_HZ[0]).toBeCloseTo(20, 9);
    expect(FREQUENCIES_HZ[239]).toBeCloseTo(20000, 6);
    expect(FREQUENCIES_HZ[120] / FREQUENCIES_HZ[119]).toBeCloseTo(FREQUENCIES_HZ[1] / FREQUENCIES_HZ[0], 9);
  });

  it("matches the shared fixture the Kotlin filter is checked against, within 0.1 dB", () => {
    for (const { gainsDb, hz, expectedDb } of fixture.cases) {
      hz.forEach((f, i) => {
        expect(Math.abs(cascadeResponseDb(gainsDb, f, fixture.sampleRate) - expectedDb[i])).toBeLessThan(0.1);
      });
    }
  });

  it("is deterministic and flat for flat gains", () => {
    expect(sampleResponse(new Array(10).fill(0)).every((db) => db === 0)).toBe(true);
    expect(sampleResponse([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual(sampleResponse([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("solves a linear system", () => {
    expect(
      solveLinear(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      ).map((v) => Math.round(v * 1e9) / 1e9),
    ).toEqual([0.8, 1.4]);
  });

  it("reproduces every tone and ambiance preset exactly at the centres", () => {
    for (const bands of [...TONE_PRESETS, ...AMBIANCE_PRESETS.map((p) => ({ bandsDb: p.sound.bandsDb }))].map(
      (p) => p.bandsDb,
    )) {
      const reached = responseAtCentres(compensatedGains(bands));
      bands.forEach((target, i) => expect(Math.abs(reached[i] - target)).toBeLessThan(0.1));
    }
  });

  it("hits 2000 target vectors within 0.1 dB, or shows the reachable value on the curve", () => {
    let clamped = 0;
    let worstReachable = 0;
    let worstMiss = 0;
    for (const targets of randomTargets(2000)) {
      const gains = compensatedGains(targets);
      expect(gains.every((g) => g >= -12 && g <= 12)).toBe(true);
      const reached = responseAtCentres(gains);
      expect(reachableTargets(targets)).toEqual(reached);
      const atClamp = gains.some((g) => Math.abs(g) >= 12);
      const worst = Math.max(...targets.map((t, i) => Math.abs(reached[i] - t)));
      if (atClamp) {
        clamped += 1;
        worstMiss = Math.max(worstMiss, worst);
      } else {
        worstReachable = Math.max(worstReachable, worst);
        expect(worst).toBeLessThan(0.1);
      }
    }
    console.info(
      `TONE-SOLVER unclamped worst ${worstReachable.toFixed(4)} dB, clamped vectors ${clamped}/2000, worst clamped miss ${worstMiss.toFixed(2)} dB`,
    );
  });

  it("keeps the response matrix well conditioned for ordinary musical curves", () => {
    const columns = Array.from({ length: 10 }, (_, j) =>
      responseAtCentres(Array.from({ length: 10 }, (_, k) => (k === j ? 6 : 0))).map((v) => v / 6),
    );
    const norm = (v: number[]) => Math.hypot(...v);
    let worst = 0;
    let best = Infinity;
    const random = mulberry32(7);
    for (let n = 0; n < 500; n += 1) {
      const x = Array.from({ length: 10 }, () => random() - 0.5);
      const y = columns[0].map((_, i) => columns.reduce((s, c, j) => s + c[i] * x[j], 0));
      const gain = norm(y) / norm(x);
      worst = Math.max(worst, gain);
      best = Math.min(best, gain);
    }
    console.info(
      `TONE-SOLVER sampled matrix gain range ${best.toFixed(3)}..${worst.toFixed(3)} (ratio ${(worst / best).toFixed(2)})`,
    );
    expect(worst / best).toBeLessThan(20);
  });

  it("treats missing and non-finite targets as 0 dB and always returns ten finite gains within the range", () => {
    const hostile = [
      [Number.NaN, 6, 0, 0, 0, 0, 0, 0, 0, 0],
      [Infinity, -Infinity, 3, 0, 0, 0, 0, 0, 0, 0],
      [3, 3, 3],
      [1e308, -1e308, 1e308, -1e308, 1e308, -1e308, 1e308, -1e308, 1e308, -1e308],
    ];
    for (const targets of hostile) {
      const gains = compensatedGains(targets);
      expect(gains).toHaveLength(10);
      for (const gain of gains) {
        expect(Number.isFinite(gain)).toBe(true);
        expect(Math.abs(gain)).toBeLessThanOrEqual(12);
      }
    }
    expect(compensatedGains([Number.NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual(new Array(10).fill(0));
    expect(compensatedGains([0, 4, Number.NaN, 0, 0, 0, 0, 0, 0, 0])).toEqual(
      compensatedGains([0, 4, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
  });
});
