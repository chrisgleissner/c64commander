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
 * The durable fix is to measure the parent commit on the SAME runner in the same job and compare
 * against that, which removes machine variation instead of trying to model it. That needs the
 * workflow to fetch more than one commit and to run the benchmarks twice, so it is deliberately
 * left as a separate change rather than folded into a build fix.
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
