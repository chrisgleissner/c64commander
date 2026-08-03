#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Live View streaming host-benchmark regression gate (spec §14.3 / §16.4). Runs the stream
 * hot-path microbenchmarks, then compares each stage's ops/s against a committed baseline within a
 * tolerance band (`hostBenchmark.thresholds.maxRegressionPct` in ci/perf/stream-perf-thresholds.json).
 *
 *   node scripts/assert-stream-perf.mjs            # gate against the committed baseline
 *   node scripts/assert-stream-perf.mjs --update   # (re)seed the baseline (requires review; §21)
 *
 * A HARD absolute CPU gate needs a dedicated, quiesced runner (a shared cloud runner is too noisy,
 * §14.3) — hence this is a RELATIVE regression gate. Machine-readable exit: 0 pass, 1 regression,
 * 2 infra/setup error. Prints a concise summary.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareStages } from "./lib/streamPerfCompare.mjs";

const ROOT = process.cwd();
const THRESHOLDS = join(ROOT, "ci/perf/stream-perf-thresholds.json");
const BASELINE = join(ROOT, "ci/perf/stream-bench-baseline.json");
const BENCH_FILE = "tests/benchmarks/streamHotPaths.bench.ts";
const update = process.argv.includes("--update");

const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

if (!existsSync(THRESHOLDS)) fail(2, `Missing thresholds config: ${THRESHOLDS}`);
const cfg = JSON.parse(readFileSync(THRESHOLDS, "utf8"));
const maxRegressionPct = cfg?.hostBenchmark?.thresholds?.maxRegressionPct;
if (typeof maxRegressionPct !== "number") fail(2, "thresholds.hostBenchmark.thresholds.maxRegressionPct missing");

/**
 * How many times to run the whole benchmark file before comparing, and why the
 * per-stage aggregate is the BEST sample rather than the median.
 *
 * Each vitest run is internally tight (±0.1%), but the run-to-run spread is
 * large: `VIC frame assembly` was observed at 40,786 / 39,895 / 23,489 ops/s on
 * an otherwise idle machine — a 74% spread that no sensible tolerance can
 * straddle. One sample per stage therefore gates noise, not code.
 *
 * The median was the first attempt at collapsing that, and it is not enough on
 * a shared public runner. Interference there is not uniform: it can stall ONE
 * stage while the others run clean, which no cross-stage normalisation can
 * cancel. `governor tick` measured 256,743 ops/s in CI against a 576,956
 * baseline — on a runner the same run rated 19% FASTER overall — while the same
 * commit measured 552k/574k/574k locally. Two slow samples out of three drag
 * the median down and the gate fails on code that never touched the governor.
 *
 * So take the MAXIMUM, which follows from the sentence already true above:
 * interference only ever makes a microbenchmark slower, never faster. The
 * fastest observed sample is therefore the least-contaminated estimate of what
 * this machine can do, and noise can only pull the others away from it.
 *
 * This does not weaken the gate. A genuine code regression makes EVERY sample
 * slower — there is no run in which the slower code is fast — so the maximum
 * drops with it and the stage is still caught at the same tolerance.
 */
const REPEATS = Number(process.env.STREAM_BENCH_REPEATS ?? 3);

const runOnce = () => {
  const outJson = join(mkdtempSync(join(tmpdir(), "streambench-")), "bench.json");
  try {
    execFileSync("npx", ["vitest", "bench", BENCH_FILE, "--project", "unit-node", "--run", "--outputJson", outJson], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (error) {
    fail(2, `Benchmark run failed: ${error.message}`);
  }
  const report = JSON.parse(readFileSync(outJson, "utf8"));
  const hz = {};
  for (const file of report.files ?? [])
    for (const group of file.groups ?? []) for (const b of group.benchmarks ?? []) hz[b.name] = b.hz;
  return hz;
};

console.log(`Running stream hot-path benchmarks (${REPEATS}x, per-stage best of ${REPEATS})…`);
const samples = {};
for (let i = 0; i < REPEATS; i += 1) {
  for (const [name, hz] of Object.entries(runOnce())) (samples[name] ??= []).push(hz);
}
const current = {};
// Best, not median — see the REPEATS comment: interference only slows a
// microbenchmark, so the fastest sample is the cleanest measurement.
for (const [name, values] of Object.entries(samples)) current[name] = Math.round(Math.max(...values));

if (Object.keys(current).length === 0) fail(2, "No benchmark results parsed");

if (update || !existsSync(BASELINE)) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      { note: "committed stream-bench baseline (ops/s); update requires review + evidence (§21)", hz: current },
      null,
      2,
    ) + "\n",
  );
  console.log(`${update ? "Updated" : "Seeded"} baseline → ${BASELINE}`);
  for (const [name, hz] of Object.entries(current)) console.log(`  ${hz.toLocaleString()} ops/s  ${name}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).hz ?? {};

/**
 * Compare each stage's share of the run against its share of the baseline, and require a genuine
 * absolute slowdown before calling it a regression. The rule, the evidence behind it and what it
 * costs are documented on `compareStages` in scripts/lib/streamPerfCompare.mjs.
 */
const { scale, rows, regressions } = compareStages({ current, baseline, maxRegressionPct });
if (scale === null) fail(2, "No stages in common between the run and the baseline");

console.log(`\nStage                                            baseline    current    Δ% (shape)`);
for (const row of rows) {
  if (row.base === null) {
    console.log(`  (new) ${row.name}: ${row.hz.toLocaleString()} ops/s — no baseline`);
    continue;
  }
  const flag = row.regressed ? "  ✗ REGRESSION" : row.suppressed ? "  · below share, but faster than baseline" : "";
  console.log(
    `  ${row.name.padEnd(46)} ${String(row.base).padStart(9)} ${String(row.hz).padStart(10)} ${row.deltaPct.toFixed(1).padStart(7)}${flag}`,
  );
}
console.log(
  `\nRunner speed vs the baseline machine: ${(scale * 100).toFixed(0)}% ` +
    `(divided out — this gate compares shape, not absolute throughput).`,
);

if (regressions.length > 0) {
  console.error(`\n${regressions.length} stage(s) regressed more than ${maxRegressionPct}% relative to the others.`);
  process.exit(1);
}
console.log(`\nAll stages within ${maxRegressionPct}% of their baseline share. PASS.`);
process.exit(0);
