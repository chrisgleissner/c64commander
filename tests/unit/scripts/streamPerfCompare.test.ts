/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs build script, no type declarations
import { compareStages } from "../../../scripts/lib/streamPerfCompare.mjs";

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
