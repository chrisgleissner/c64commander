/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * HIGH-VISIBILITY FLAKY-TEST REPORTER for vitest (stop-gap).
 *
 * Mirror of playwright/reporters/flakyVisibilityReporter.ts for unit tests: when
 * `retry` (vitest.config.ts) lets a unit test pass only after a rerun, that retry
 * is made LOUD — console banner + GitHub `::warning::` annotation + job summary
 * entry — so unit flakiness is tracked and fixed, never silently normalised.
 *
 * Defensive by design: any failure inside the reporter is swallowed so it can
 * never break the unit-test run. See docs/flaky-tests.md.
 */

const DOC_REFERENCE = "docs/flaky-tests.md";

type FlakyEntry = {
  name: string;
  file: string;
  retries: number;
};

type AnyTask = {
  type?: string;
  name?: string;
  mode?: string;
  result?: { state?: string; retryCount?: number };
  tasks?: AnyTask[];
};

type AnyFile = AnyTask & { filepath?: string; name?: string };

function collectFlaky(task: AnyTask, file: string, out: FlakyEntry[]): void {
  if (task.type === "test" || (!task.tasks && task.result)) {
    const retries = task.result?.retryCount ?? 0;
    if (task.result?.state === "pass" && retries > 0) {
      out.push({ name: task.name ?? "(unnamed test)", file, retries });
    }
    return;
  }
  for (const child of task.tasks ?? []) {
    collectFlaky(child, file, out);
  }
}

export default class VitestFlakyReporter {
  onFinished(files: AnyFile[] = []): void {
    try {
      const flaky: FlakyEntry[] = [];
      for (const file of files) {
        const filePath = file.filepath ? path.relative(process.cwd(), file.filepath) : (file.name ?? "unknown");
        collectFlaky(file, filePath, flaky);
      }

      this.writeJson(flaky);
      if (flaky.length === 0) return;

      this.emitConsoleBanner(flaky);
      this.emitGitHubAnnotations(flaky);
      this.emitStepSummary(flaky);
    } catch {
      // A reporter must never fail the unit-test run.
    }
  }

  private writeJson(flaky: FlakyEntry[]): void {
    try {
      const dir = path.join(process.cwd(), "test-results", "flaky");
      mkdirSync(dir, { recursive: true });
      // The coverage runner spawns one process per chunk; suffix with the pid so
      // chunks do not clobber each other's report.
      writeFileSync(
        path.join(dir, `flaky-unit-${process.pid}.json`),
        `${JSON.stringify({ shard: "unit", count: flaky.length, tests: flaky }, null, 2)}\n`,
      );
    } catch {
      // best-effort
    }
  }

  private emitConsoleBanner(flaky: FlakyEntry[]): void {
    const lines = [
      "",
      "================================================================",
      `⚠️  FLAKY UNIT TESTS DETECTED: ${flaky.length} test(s) passed ONLY on retry`,
      "    Green via the retry stop-gap, NOT because they are healthy.",
      `    Triage + fix them — see ${DOC_REFERENCE}.`,
      "----------------------------------------------------------------",
      ...flaky.map(
        (entry) =>
          `    • ${entry.name}  [${entry.file}]  (passed after ${entry.retries} retr${entry.retries === 1 ? "y" : "ies"})`,
      ),
      "================================================================",
      "",
    ];
    console.log(lines.join("\n"));
  }

  private emitGitHubAnnotations(flaky: FlakyEntry[]): void {
    if (!process.env.GITHUB_ACTIONS) return;
    for (const entry of flaky) {
      const message = `FLAKY (stop-gap retry): unit test "${entry.name}" passed only after ${entry.retries} retr${entry.retries === 1 ? "y" : "ies"}. Triage per ${DOC_REFERENCE}.`;
      console.log(`::warning file=${entry.file},title=Flaky unit test (passed on retry)::${message}`);
    }
  }

  private emitStepSummary(flaky: FlakyEntry[]): void {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;
    const rows = flaky.map((entry) => `| \`${entry.name}\` | \`${entry.file}\` | ${entry.retries} |`).join("\n");
    const block = [
      "",
      "### ⚠️ Flaky unit tests (passed only on retry)",
      "",
      `**${flaky.length}** unit test(s) needed a retry to pass. Green via the retry stop-gap, not stability. Triage per \`${DOC_REFERENCE}\`.`,
      "",
      "| Test | File | Retries |",
      "| --- | --- | --- |",
      rows,
      "",
    ].join("\n");
    try {
      appendFileSync(summaryPath, block);
    } catch {
      // best-effort
    }
  }
}
