/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs build script, no type declarations
import { collectBestOf, compareStages, runStreamBenchGate } from "../../../scripts/lib/streamPerfCompare.mjs";

/**
 * The stream host-benchmark gate failed three times on streaming code that had not changed, once
 * on a commit that touched only the generated manuals. These are the numbers CI actually printed,
 * so the rule is asserted against the runs it exists to get right rather than against invented
 * figures.
 */

const BASELINE = {
  "VIC frame assembly (68 packets → 1 frame)": 32213,
  "audio PLC timeline advance (contiguous packet)": 1514034,
  "audio concealment fill (one 768-byte packet)": 932457,
  "governor tick": 576956,
  "telemetry ingest (one 10 Hz sample)": 183305,
  "audio bytesToInt16 of one packet": 170767,
};

const MAX_REGRESSION_PCT = 25;

const compare = (current: Record<string, number>) =>
  compareStages({ current, baseline: BASELINE, maxRegressionPct: MAX_REGRESSION_PCT }) as {
    scale: number | null;
    rows: Array<{ name: string; deltaPct: number | null; regressed: boolean; suppressed: boolean }>;
    regressions: Array<{ name: string }>;
  };

const names = (rows: Array<{ name: string }>) => rows.map((row) => row.name).sort();

describe("the stream benchmark gate on runs of unchanged code", () => {
  // Run of 2026-08-03 on a docs-only commit. The runner measured 161% of the baseline machine and
  // both flagged stages were FASTER than the baseline in absolute ops/s.
  it("passes the 161% runner that failed on governor tick and audio PLC", () => {
    const { scale, regressions, rows } = compare({
      "VIC frame assembly (68 packets → 1 frame)": 55074,
      "audio PLC timeline advance (contiguous packet)": 1823467,
      "audio concealment fill (one 768-byte packet)": 1502254,
      "governor tick": 640643,
      "telemetry ingest (one 10 Hz sample)": 296521,
      "audio bytesToInt16 of one packet": 302281,
    });

    expect(scale).toBeGreaterThan(1.5);
    expect(names(regressions)).toEqual([]);

    // Both stages still lost share, and the report still says so — the finding is reported, it
    // just does not fail the build.
    const suppressed = names(rows.filter((row) => row.suppressed));
    expect(suppressed).toEqual(["audio PLC timeline advance (contiguous packet)", "governor tick"]);
  });

  // Run of 2026-08-02, which failed by a tenth of a point on the same unchanged code.
  it("passes the 143% runner that failed governor tick by 0.1 points", () => {
    const { regressions } = compare({
      "VIC frame assembly (68 packets → 1 frame)": 51511,
      "audio PLC timeline advance (contiguous packet)": 1730737,
      "audio concealment fill (one 768-byte packet)": 1343480,
      "governor tick": 618773,
      "telemetry ingest (one 10 Hz sample)": 260619,
      "audio bytesToInt16 of one packet": 297447,
    });

    expect(names(regressions)).toEqual([]);
  });
});

describe("the stream benchmark gate on a genuine slowdown", () => {
  // The gate has to keep its teeth: a hot path that actually got slower is slower in absolute
  // ops/s too, so it is still caught.
  it("still fails a stage that halved while the rest of the run held its speed", () => {
    const { regressions } = compare({ ...BASELINE, "governor tick": Math.round(576956 * 0.5) });

    expect(names(regressions)).toEqual(["governor tick"]);
  });

  it("still fails a stage that halved on a runner half again as fast", () => {
    const scaled = Object.fromEntries(Object.entries(BASELINE).map(([name, hz]) => [name, Math.round(hz * 1.5)]));
    const { regressions } = compare({ ...scaled, "governor tick": Math.round(576956 * 1.5 * 0.5) });

    expect(names(regressions)).toEqual(["governor tick"]);
  });

  it("reports a stage with no baseline rather than judging it", () => {
    const { rows, regressions } = compare({ ...BASELINE, "a newly added hot path": 1000 });

    expect(regressions).toEqual([]);
    expect(rows.find((row) => row.name === "a newly added hot path")?.deltaPct).toBeNull();
  });
});

/**
 * Stage numbers from two CI runs of unchanged streaming code. The logs do not name the CPU, but
 * both runs show the same profile against the committed baseline (concealment fill about -2%,
 * telemetry about +2%, bytesToInt16 +20 to +24%), which most of the other 36 recorded runs do not,
 * so they stand in for the parent commit measured on the same runner. On this profile
 * `governor tick` sits about 25% below its committed share.
 */
const RUN_2026_10_02_GOVERNOR_FAILURE = {
  "VIC frame assembly (68 packets → 1 frame)": 42471,
  "audio PLC timeline advance (contiguous packet)": 1557484,
  "audio concealment fill (one 768-byte packet)": 1197061,
  "governor tick": 555754,
  "telemetry ingest (one 10 Hz sample)": 245581,
  "audio bytesToInt16 of one packet": 267374,
};
const RUN_2026_09_25_SAME_CPU_MODEL = {
  "VIC frame assembly (68 packets → 1 frame)": 45171,
  "audio PLC timeline advance (contiguous packet)": 1516599,
  "audio concealment fill (one 768-byte packet)": 1138640,
  "governor tick": 539051,
  "telemetry ingest (one 10 Hz sample)": 231855,
  "audio bytesToInt16 of one packet": 262377,
};

type GateResult = { baselineSource: string; regressions: Array<{ name: string }> };

const gate = (options: { againstBase: boolean; head: Record<string, number>; base?: Record<string, number> }) =>
  runStreamBenchGate({
    repeats: 1,
    runBench: (tree: string) => (tree === "base" ? options.base : options.head),
    againstBase: options.againstBase,
    committedBaseline: BASELINE,
    maxRegressionPct: MAX_REGRESSION_PCT,
  }) as GateResult;

describe("the stream benchmark gate against the parent commit on the same runner", () => {
  it("fails the 2026-10-02 run on governor tick when it is compared with the committed baseline", () => {
    const result = gate({ againstBase: false, head: RUN_2026_10_02_GOVERNOR_FAILURE });

    expect(result.baselineSource).toBe("committed");
    expect(names(result.regressions)).toEqual(["governor tick"]);
  });

  it("passes the same run when the baseline is unchanged code measured on the same CPU model", () => {
    const result = gate({
      againstBase: true,
      head: RUN_2026_10_02_GOVERNOR_FAILURE,
      base: RUN_2026_09_25_SAME_CPU_MODEL,
    });

    expect(names(result.regressions)).toEqual([]);
    expect(result.baselineSource).toBe("base");
  });

  it("still fails a governor tick that lost 30% against the parent on the same runner", () => {
    const result = gate({
      againstBase: true,
      head: {
        ...RUN_2026_10_02_GOVERNOR_FAILURE,
        "governor tick": Math.round(RUN_2026_10_02_GOVERNOR_FAILURE["governor tick"] * 0.7),
      },
      base: RUN_2026_09_25_SAME_CPU_MODEL,
    });

    expect(names(result.regressions)).toEqual(["governor tick"]);
  });

  it("alternates between the two trees and keeps each stage's fastest sample per tree", () => {
    const calls: string[] = [];
    const samples: Record<string, number[]> = { head: [100, 300, 200], base: [50, 40, 60] };
    const best = collectBestOf({
      repeats: 3,
      trees: ["head", "base"],
      runBench: (tree: string) => {
        calls.push(tree);
        return { stage: samples[tree][calls.filter((call) => call === tree).length - 1] };
      },
    });

    expect(calls).toEqual(["head", "base", "head", "base", "head", "base"]);
    expect(best).toEqual({ head: { stage: 300 }, base: { stage: 60 } });
  });
});
