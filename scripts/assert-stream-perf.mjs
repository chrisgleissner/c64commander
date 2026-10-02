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
 * hot-path microbenchmarks, then compares each stage's ops/s against a baseline within a
 * tolerance band (`hostBenchmark.thresholds.maxRegressionPct` in ci/perf/stream-perf-thresholds.json).
 *
 *   node scripts/assert-stream-perf.mjs                  # gate against the committed baseline
 *   node scripts/assert-stream-perf.mjs --against HEAD^1 # gate against HEAD^1 benchmarked here
 *   node scripts/assert-stream-perf.mjs --update         # (re)seed the baseline (requires review; §21)
 *
 * CI passes `--against` (STREAM_BENCH_AGAINST): the committed baseline was seeded on one machine,
 * and GitHub's runners differ from it in CPU model by more than the tolerance. Benchmarking the
 * parent commit in the same job compares like with like.
 *
 * A HARD absolute CPU gate needs a dedicated, quiesced runner (a shared cloud runner is too noisy,
 * §14.3) — hence this is a RELATIVE regression gate. Machine-readable exit: 0 pass, 1 regression,
 * 2 infra/setup error. Prints a concise summary.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBestOf, runStreamBenchGate } from "./lib/streamPerfCompare.mjs";

const ROOT = process.cwd();
const THRESHOLDS = join(ROOT, "ci/perf/stream-perf-thresholds.json");
const BASELINE = join(ROOT, "ci/perf/stream-bench-baseline.json");
const BENCH_FILE = "tests/benchmarks/streamHotPaths.bench.ts";
const update = process.argv.includes("--update");
const againstFlag = process.argv.indexOf("--against");
const againstRef = againstFlag >= 0 ? process.argv[againstFlag + 1] : process.env.STREAM_BENCH_AGAINST || null;

const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

if (!existsSync(THRESHOLDS)) fail(2, `Missing thresholds config: ${THRESHOLDS}`);
const cfg = JSON.parse(readFileSync(THRESHOLDS, "utf8"));
const maxRegressionPct = cfg?.hostBenchmark?.thresholds?.maxRegressionPct;
if (typeof maxRegressionPct !== "number") fail(2, "thresholds.hostBenchmark.thresholds.maxRegressionPct missing");
if (againstFlag >= 0 && !againstRef) fail(2, "--against needs a git ref");
if (update && againstRef) fail(2, "--update seeds the committed baseline; it cannot be combined with --against");

/**
 * Each vitest run is internally tight (±0.1%), but the run-to-run spread is large: `VIC frame
 * assembly` was observed at 40,786 / 39,895 / 23,489 ops/s on an otherwise idle machine. One
 * sample per stage therefore gates noise, not code, so every tree is run REPEATS times and each
 * stage keeps its fastest sample (see `collectBestOf`).
 */
const REPEATS = Number(process.env.STREAM_BENCH_REPEATS ?? 3);

const runBenchIn = (cwd) => {
  const outJson = join(mkdtempSync(join(tmpdir(), "streambench-")), "bench.json");
  try {
    execFileSync("npx", ["vitest", "bench", BENCH_FILE, "--project", "unit-node", "--run", "--outputJson", outJson], {
      cwd,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (error) {
    throw new Error(`Benchmark run in ${cwd} failed: ${error.message}`, { cause: error });
  }
  const report = JSON.parse(readFileSync(outJson, "utf8"));
  const hz = {};
  for (const file of report.files ?? [])
    for (const group of file.groups ?? []) for (const b of group.benchmarks ?? []) hz[b.name] = b.hz;
  if (Object.keys(hz).length === 0) throw new Error(`No benchmark results parsed from the run in ${cwd}`);
  return hz;
};

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

const checkoutBaseTree = (ref) => {
  let sha;
  try {
    sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch (error) {
    fail(2, `Cannot resolve --against ${ref} (CI needs fetch-depth >= 2): ${error.message}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "streambench-base-"));
  git(["worktree", "add", "--detach", dir, sha]);
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  return { sha, dir };
};

if (update || (!againstRef && !existsSync(BASELINE))) {
  console.log(`Running stream hot-path benchmarks (${REPEATS}x, per-stage best of ${REPEATS})…`);
  let head;
  try {
    ({ head } = collectBestOf({ repeats: REPEATS, trees: ["head"], runBench: () => runBenchIn(ROOT) }));
  } catch (error) {
    fail(2, error.message);
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      { note: "committed stream-bench baseline (ops/s); update requires review + evidence (§21)", hz: head },
      null,
      2,
    ) + "\n",
  );
  console.log(`${update ? "Updated" : "Seeded"} baseline → ${BASELINE}`);
  for (const [name, hz] of Object.entries(head)) console.log(`  ${hz.toLocaleString()} ops/s  ${name}`);
  process.exit(0);
}

const baseTree = againstRef ? checkoutBaseTree(againstRef) : null;
let gate;
let benchError = null;
try {
  console.log(
    baseTree
      ? `Running stream hot-path benchmarks for this commit and ${againstRef} (${baseTree.sha.slice(0, 12)}), ` +
          `alternating, ${REPEATS}x each, per-stage best of ${REPEATS}…`
      : `Running stream hot-path benchmarks (${REPEATS}x, per-stage best of ${REPEATS}) against the committed baseline…`,
  );
  gate = runStreamBenchGate({
    repeats: REPEATS,
    runBench: (tree) => runBenchIn(tree === "base" ? baseTree.dir : ROOT),
    againstBase: baseTree !== null,
    committedBaseline: baseTree ? null : (JSON.parse(readFileSync(BASELINE, "utf8")).hz ?? {}),
    maxRegressionPct,
  });
} catch (error) {
  benchError = error;
} finally {
  if (baseTree) {
    try {
      git(["worktree", "remove", "--force", baseTree.dir]);
    } catch (error) {
      console.warn(`Could not remove the base worktree ${baseTree.dir}: ${error.message}`);
    }
  }
}
if (benchError) fail(2, benchError.message);

/**
 * Each stage's share of the run is compared against its share of the baseline, and a genuine
 * absolute slowdown is required before calling it a regression. The rule, the evidence behind it
 * and what it costs are documented on `compareStages` in scripts/lib/streamPerfCompare.mjs.
 */
const { scale, rows, regressions } = gate;
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
  baseTree
    ? `\nThis commit vs ${againstRef} on the same runner: ${(scale * 100).toFixed(0)}% overall.`
    : `\nRunner speed vs the baseline machine: ${(scale * 100).toFixed(0)}% ` +
        `(divided out — this gate compares shape, not absolute throughput).`,
);

if (regressions.length > 0) {
  console.error(`\n${regressions.length} stage(s) regressed more than ${maxRegressionPct}% relative to the others.`);
  process.exit(1);
}
console.log(`\nAll stages within ${maxRegressionPct}% of their baseline share. PASS.`);
process.exit(0);
