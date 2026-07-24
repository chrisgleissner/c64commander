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

const outJson = join(mkdtempSync(join(tmpdir(), "streambench-")), "bench.json");
console.log("Running stream hot-path benchmarks…");
try {
  execFileSync("npx", ["vitest", "bench", BENCH_FILE, "--project", "unit-node", "--run", "--outputJson", outJson], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
} catch (error) {
  fail(2, `Benchmark run failed: ${error.message}`);
}

const report = JSON.parse(readFileSync(outJson, "utf8"));
const current = {};
for (const file of report.files ?? [])
  for (const group of file.groups ?? []) for (const b of group.benchmarks ?? []) current[b.name] = Math.round(b.hz);

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
const regressions = [];
console.log(`\nStage                                              baseline      current    Δ%`);
for (const [name, hz] of Object.entries(current)) {
  const base = baseline[name];
  if (typeof base !== "number") {
    console.log(`  (new) ${name}: ${hz.toLocaleString()} ops/s — no baseline`);
    continue;
  }
  const deltaPct = ((hz - base) / base) * 100;
  const flag = -deltaPct > maxRegressionPct ? "  ✗ REGRESSION" : "";
  console.log(
    `  ${name.padEnd(46)} ${String(base).padStart(10)} ${String(hz).padStart(12)} ${deltaPct.toFixed(1).padStart(6)}${flag}`,
  );
  if (-deltaPct > maxRegressionPct) regressions.push({ name, base, hz, deltaPct });
}

if (regressions.length > 0) {
  console.error(`\n${regressions.length} stage(s) regressed more than ${maxRegressionPct}%.`);
  process.exit(1);
}
console.log(`\nAll stages within ${maxRegressionPct}% of baseline. PASS.`);
process.exit(0);
