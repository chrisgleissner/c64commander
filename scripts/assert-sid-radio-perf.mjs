#!/usr/bin/env node
/*
 * Asserts a captured `sid-radio-stats` blob against the MEASURED-then-PINNED
 * SID Radio performance budgets (ci/perf/sid-radio-perf-thresholds.json,
 * spec §9.2). Exits 1 on any regression. The Pixel-4 HIL
 * (tools/hil/sid_radio_hil.py) captures the stats over CDP and calls this to
 * gate the run; the logic is factored here so it is unit-testable in CI.
 *
 * Usage: node scripts/assert-sid-radio-perf.mjs <stats.json> [thresholds.json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_THRESHOLDS_PATH = path.resolve(SCRIPT_DIR, "../ci/perf/sid-radio-perf-thresholds.json");

/** Resolve a (possibly composite `a+b`) metric expression against a stats object. */
export const resolveMetric = (stats, metric) => {
  if (metric.includes("+")) {
    return metric.split("+").reduce((sum, key) => sum + (Number(stats[key.trim()]) || 0), 0);
  }
  return stats[metric];
};

const checkBound = (value, bound, pinned) => {
  switch (bound) {
    case "max":
      return value <= pinned;
    case "min":
      return value >= pinned;
    case "equals":
      return value === pinned;
    default:
      return true;
  }
};

/**
 * @returns {{ passed: boolean, failures: Array<{name,metric,bound,pinned,actual}>, checked: number, skipped: string[] }}
 */
export const assertSidRadioPerf = (stats, thresholdsDoc) => {
  const failures = [];
  const skipped = [];
  let checked = 0;
  // Both the SID Radio budgets (§9.2) and the Local engine budgets (§12.6,
  // Track B / LE3) are asserted against the same stats blob; unmeasured metrics
  // are skipped, not failed.
  const groups = [thresholdsDoc.thresholds ?? {}, thresholdsDoc.localEngine ?? {}];
  for (const group of groups) {
    for (const [name, spec] of Object.entries(group)) {
      const actual = resolveMetric(stats, spec.metric);
      if (actual === undefined || actual === null) {
        skipped.push(name);
        continue;
      }
      checked += 1;
      if (!checkBound(actual, spec.bound, spec.pinned)) {
        failures.push({ name, metric: spec.metric, bound: spec.bound, pinned: spec.pinned, actual });
      }
    }
  }
  return { passed: failures.length === 0, failures, checked, skipped };
};

const main = () => {
  const [statsArg, thresholdsArg] = process.argv.slice(2);
  if (!statsArg) {
    console.error("usage: node scripts/assert-sid-radio-perf.mjs <stats.json> [thresholds.json]");
    process.exitCode = 2;
    return;
  }
  const stats = JSON.parse(fs.readFileSync(statsArg, "utf8"));
  const thresholds = JSON.parse(fs.readFileSync(thresholdsArg ?? DEFAULT_THRESHOLDS_PATH, "utf8"));
  const result = assertSidRadioPerf(stats, thresholds);
  for (const failure of result.failures) {
    console.error(
      `[sid-radio-perf] REGRESSION ${failure.name}: ${failure.metric}=${failure.actual} violates ${failure.bound} ${failure.pinned}`,
    );
  }
  console.log(
    `[sid-radio-perf] ${result.passed ? "PASS" : "FAIL"} — ${result.checked} checked, ${result.skipped.length} skipped (unmeasured)`,
  );
  if (!result.passed) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
