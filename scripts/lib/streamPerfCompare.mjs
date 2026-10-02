/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The comparison the stream host-benchmark gate performs, as a pure function.
 *
 * Kept out of `assert-stream-perf.mjs` so it can be tested with recorded numbers instead of by
 * running the benchmarks: the failures this rule exists to prevent were only ever reproducible
 * on a CI runner, and a test that has to reproduce them by measuring cannot assert anything.
 */

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Compare each stage's share of the run against its share of the baseline.
 *
 * Dividing every stage by the median of the per-stage current/baseline ratios cancels a machine
 * speed factor that applies EQUALLY to every stage. That premise does not hold across GitHub's
 * runner fleet. The stages are not alike — some are compute-bound, some allocate, some are bound
 * by memory bandwidth — so a different CPU model does not scale them by one common factor, and
 * the median ratio then reads as "the machine speed" while the stages that scaled least look
 * regressed. Three observed runs of IDENTICAL streaming code:
 *
 *   runner 143%: governor tick -25.1%  (fail by a tenth of a point)
 *   runner 161%: governor tick -31.0%, audio PLC timeline advance -25.2%  (fail)
 *   runner ~100%: all stages within tolerance  (pass)
 *
 * In the 161% run both flagged stages measured FASTER in absolute ops/s than the baseline itself
 * — 1,823,467 against 1,514,034, and 640,643 against 576,956. Reporting a code regression for a
 * stage that outran the machine which seeded the baseline is not defensible, so absolute
 * throughput is now a necessary condition: a stage is flagged only when its share dropped by
 * more than the tolerance AND it is genuinely slower than the baseline number.
 *
 * What this costs, stated plainly: on a runner fast enough that regressed code still outruns the
 * baseline machine, that regression is not caught. At the 143-161% spread seen here a stage would
 * have to keep more than half its throughput after regressing to hide, and a slowdown of that
 * size still shows up in the absolute ops/s printed alongside. The alternative — trusting the
 * shape signal alone — is what produced three false failures on unchanged code, and a gate that
 * fails on documentation commits is one that gets ignored rather than read.
 *
 * Neither guard is enough against a committed baseline. Across 38 recorded CI runs of unchanged
 * code, `governor tick` lost between 9% and 29% of its share depending on which CPU model the
 * runner had, so the 25% tolerance sits inside the spread of the runner fleet. CI therefore
 * compares against the parent commit measured in the same job (`runStreamBenchGate`).
 */
export const compareStages = ({ current, baseline, maxRegressionPct }) => {
  const shared = Object.keys(current).filter((name) => typeof baseline[name] === "number");
  if (shared.length === 0) return { scale: null, rows: [], regressions: [] };

  // Median rather than mean: one stage that happens to scale differently on a given CPU must not
  // drag every other stage's share with it.
  const scale = median(shared.map((name) => current[name] / baseline[name]));

  const rows = Object.entries(current).map(([name, hz]) => {
    const base = baseline[name];
    if (typeof base !== "number") return { name, hz, base: null, deltaPct: null, regressed: false, suppressed: false };
    const deltaPct = (hz / base / scale - 1) * 100;
    const lostShare = -deltaPct > maxRegressionPct;
    const slowerThanBaseline = hz < base;
    return {
      name,
      base,
      hz,
      deltaPct,
      regressed: lostShare && slowerThanBaseline,
      // Reported rather than dropped: a stage that keeps losing share run after run is worth
      // seeing even when its absolute throughput says it is not a regression.
      suppressed: lostShare && !slowerThanBaseline,
    };
  });

  return { scale, rows, regressions: rows.filter((row) => row.regressed) };
};

/**
 * Run the benchmark `repeats` times for each tree, alternating between the trees so that a slow
 * stretch on the runner lands on both, and keep each stage's fastest sample per tree.
 *
 * The fastest sample, not the median: interference only ever makes a microbenchmark slower, so
 * the fastest sample is the least contaminated one. A genuine regression makes every sample
 * slower, so the fastest sample still drops with it.
 */
export const collectBestOf = ({ repeats, trees, runBench }) => {
  const samples = Object.fromEntries(trees.map((tree) => [tree, {}]));
  for (let i = 0; i < repeats; i += 1) {
    for (const tree of trees) {
      for (const [name, hz] of Object.entries(runBench(tree))) (samples[tree][name] ??= []).push(hz);
    }
  }
  return Object.fromEntries(
    trees.map((tree) => [
      tree,
      Object.fromEntries(
        Object.entries(samples[tree]).map(([name, values]) => [name, Math.round(Math.max(...values))]),
      ),
    ]),
  );
};

/**
 * The whole gate decision. With `againstBase`, the baseline is the parent commit benchmarked on the
 * same runner in the same job (`runBench("base")`), which removes the CPU-model differences that a
 * committed baseline cannot account for. Without it, the committed baseline is used, which is only
 * meaningful on the machine that seeded it.
 */
export const runStreamBenchGate = ({ repeats, runBench, againstBase, committedBaseline, maxRegressionPct }) => {
  if (againstBase) {
    const { head, base } = collectBestOf({ repeats, trees: ["head", "base"], runBench });
    return {
      baselineSource: "base",
      current: head,
      baseline: base,
      ...compareStages({ current: head, baseline: base, maxRegressionPct }),
    };
  }
  const { head } = collectBestOf({ repeats, trees: ["head"], runBench });
  return {
    baselineSource: "committed",
    current: head,
    baseline: committedBaseline,
    ...compareStages({ current: head, baseline: committedBaseline, maxRegressionPct }),
  };
};
