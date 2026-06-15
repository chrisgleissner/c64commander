/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

/**
 * HIGH-VISIBILITY FLAKY-TEST REPORTER (stop-gap).
 *
 * Retries (playwright.config.ts `retries`) keep the build green when a test is
 * flaky, but a silent retry is exactly how a suite rots: one flaky test becomes
 * ten and nobody notices. This reporter makes every retry LOUD and impossible to
 * miss so flakiness is tracked and paid down, never normalised:
 *
 *   - a banner on the test step's stdout (local + CI),
 *   - a `::warning::` GitHub annotation per flaky test (these surface at the TOP
 *     of the workflow run, aggregated across every shard),
 *   - a section appended to the GitHub job summary ($GITHUB_STEP_SUMMARY),
 *   - a machine-readable JSON drop (test-results/flaky/flaky-<shard>.json).
 *
 * See docs/flaky-tests.md for why this exists and how to retire it.
 */

type FlakyEntry = {
  title: string;
  location: string;
  retries: number;
  shard: string;
};

const DOC_REFERENCE = "docs/flaky-tests.md";

function shardLabel(config: FullConfig | undefined): string {
  const shard = config?.shard;
  if (shard) return `${shard.current}/${shard.total}`;
  return process.env.PLAYWRIGHT_SHARD_LABEL ?? "all";
}

function relativeLocation(test: TestCase): string {
  const { file, line, column } = test.location;
  return `${path.relative(process.cwd(), file)}:${line}:${column}`;
}

export default class FlakyVisibilityReporter implements Reporter {
  private rootSuite: Suite | undefined;
  private config: FullConfig | undefined;

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.rootSuite = suite;
  }

  onEnd(_result: FullResult): void {
    const suite = this.rootSuite;
    if (!suite) return;

    const shard = shardLabel(this.config);
    const flaky: FlakyEntry[] = [];

    for (const test of suite.allTests()) {
      // Playwright marks a test "flaky" when it failed at least once but a retry
      // passed. That is precisely the signal that must never be silent.
      if (test.outcome() !== "flaky") continue;
      const retries = Math.max(0, test.results.length - 1);
      flaky.push({
        title: test.titlePath().filter(Boolean).join(" › "),
        location: relativeLocation(test),
        retries,
        shard,
      });
    }

    this.writeJson(shard, flaky);

    if (flaky.length === 0) return;

    this.emitConsoleBanner(shard, flaky);
    this.emitGitHubAnnotations(flaky);
    this.emitStepSummary(shard, flaky);
  }

  private writeJson(shard: string, flaky: FlakyEntry[]): void {
    try {
      const dir = path.join(process.cwd(), "test-results", "flaky");
      mkdirSync(dir, { recursive: true });
      const safeShard = shard.replace(/[^\w.-]+/g, "-");
      writeFileSync(
        path.join(dir, `flaky-${safeShard}.json`),
        `${JSON.stringify({ shard, count: flaky.length, tests: flaky }, null, 2)}\n`,
      );
    } catch {
      // Never let reporting failures break the run; the banner/annotations still fire.
    }
  }

  private emitConsoleBanner(shard: string, flaky: FlakyEntry[]): void {
    const lines = [
      "",
      "================================================================",
      `⚠️  FLAKY TESTS DETECTED (shard ${shard}): ${flaky.length} test(s) passed ONLY on retry`,
      "    These are green via the retry stop-gap, NOT because they are healthy.",
      `    Triage + fix them — see ${DOC_REFERENCE}.`,
      "----------------------------------------------------------------",
      ...flaky.map(
        (entry) =>
          `    • ${entry.title}  [${entry.location}]  (passed after ${entry.retries} retr${entry.retries === 1 ? "y" : "ies"})`,
      ),
      "================================================================",
      "",
    ];
    console.log(lines.join("\n"));
  }

  private emitGitHubAnnotations(flaky: FlakyEntry[]): void {
    if (!process.env.GITHUB_ACTIONS) return;
    for (const entry of flaky) {
      const [file, line] = entry.location.split(":");
      const message = `FLAKY (stop-gap retry): "${entry.title}" passed only after ${entry.retries} retr${entry.retries === 1 ? "y" : "ies"}. Triage per ${DOC_REFERENCE}.`;
      console.log(`::warning file=${file},line=${line},title=Flaky test (passed on retry)::${message}`);
    }
  }

  private emitStepSummary(shard: string, flaky: FlakyEntry[]): void {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;
    const rows = flaky.map((entry) => `| \`${entry.title}\` | \`${entry.location}\` | ${entry.retries} |`).join("\n");
    const block = [
      "",
      `### ⚠️ Flaky tests — shard ${shard} (passed only on retry)`,
      "",
      `**${flaky.length}** test(s) needed a retry to pass. The build is green via the retry stop-gap, not because these tests are stable. Triage per [\`${DOC_REFERENCE}\`](../blob/HEAD/${DOC_REFERENCE}).`,
      "",
      "| Test | Location | Retries |",
      "| --- | --- | --- |",
      rows,
      "",
    ].join("\n");
    try {
      appendFileSync(summaryPath, block);
    } catch {
      // Summary is best-effort; annotations remain the primary signal.
    }
  }
}
