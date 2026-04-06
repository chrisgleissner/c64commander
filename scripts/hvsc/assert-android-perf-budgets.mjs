#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key, value ?? ""];
  }),
);

const filePath =
  args.get("--file") ||
  process.env.HVSC_ANDROID_PERF_SUMMARY_FILE ||
  "ci-artifacts/hvsc-performance/android/latest/summary.json";
const summary = JSON.parse(readFileSync(filePath, "utf8"));

const evidence = summary.targetEvidence;
if (!evidence) {
  process.stderr.write(
    "No targetEvidence found in summary. Ensure the benchmark runner completed at least one measured loop.\n",
  );
  process.exit(1);
}

const budgets = [
  {
    id: "UX1",
    env: "HVSC_BUDGET_FEEDBACK_P95",
    defaultMs: 2_000,
    label: "Visible feedback or result < 2s",
  },
  {
    id: "T1",
    env: "HVSC_BUDGET_DOWNLOAD_P95",
    defaultMs: 20_000,
    label: "Download full HVSC < 20s",
  },
  {
    id: "T2",
    env: "HVSC_BUDGET_INGEST_P95",
    defaultMs: 25_000,
    label: "Ingest 60K+ songs < 25s",
  },
  {
    id: "T3",
    env: "HVSC_BUDGET_BROWSE_P95",
    defaultMs: 2_000,
    label: "Browse traversal < 2s",
  },
  {
    id: "T4",
    env: "HVSC_BUDGET_FILTER_P95",
    defaultMs: 2_000,
    label: "Filter 60K+ playlist < 2s",
  },
  {
    id: "T5",
    env: "HVSC_BUDGET_PLAYBACK_P95",
    defaultMs: 1_000,
    label: "Playback start < 1s",
  },
  {
    id: "T6",
    env: "HVSC_BUDGET_PLAYLIST_SCALE_COUNT",
    defaultMs: 100_000,
    label: "100K playlist scale without React-owned hot path",
  },
];

const enforced = process.env.HVSC_ANDROID_BUDGET_ENFORCE === "1";
const failures = [];
const results = [];

for (const budget of budgets) {
  const target = evidence[budget.id];
  if (!target) {
    results.push(`  ${budget.id} ${budget.label}: missing from evidence`);
    if (enforced) failures.push(`${budget.id}: missing target evidence`);
    continue;
  }
  const budgetMs = process.env[budget.env] ? Number(process.env[budget.env]) : budget.defaultMs;
  const status = target.status;
  const isCountTarget = budget.id === "T6";
  const actualValue = isCountTarget ? target.actualCount : target.actualMs;
  const unit = isCountTarget ? "items" : "ms";
  const budgetLabel = isCountTarget ? "required" : "budget";
  const line = `  ${budget.id} ${budget.label}: ${status} (actual=${actualValue ?? "n/a"}${unit}, ${budgetLabel}=${budgetMs}${unit}, source=${target.source})`;
  results.push(line);
  if (budget.id === "UX1" && target.stageResults) {
    const stageSummary = Object.entries(target.stageResults)
      .map(([stage, stageResult]) => {
        if (!stageResult || typeof stageResult !== "object") return `${stage}=unmeasured`;
        const visibleWithinMs =
          typeof stageResult.visibleWithinMs === "number" ? `${stageResult.visibleWithinMs}ms` : "n/a";
        return `${stage}=${stageResult.withinBudget ? "pass" : "fail"}@${visibleWithinMs}`;
      })
      .join(", ");
    results.push(`    stages: ${stageSummary}`);
  }
  if (budget.id === "T6") {
    results.push(
      `    queryEngines=${(target.queryEngines ?? []).join("|") || "n/a"}, playlistOwnership=${(target.playlistOwnership ?? []).join("|") || "n/a"}`,
    );
  }
  if (enforced && status === "fail") {
    failures.push(`${budget.id}: actual ${actualValue ?? "n/a"}${unit} exceeds ${budgetLabel} ${budgetMs}${unit}`);
  }
  if (enforced && status === "unmeasured") {
    failures.push(`${budget.id}: unmeasured`);
  }
}

process.stdout.write("Android HVSC performance budget results:\n");
process.stdout.write(results.join("\n") + "\n");
process.stdout.write(`\nMode: ${enforced ? "enforced" : "observation-only"}\n`);
process.stdout.write(`Loops: ${summary.loops ?? "unknown"}, Warmup: ${summary.warmup ?? "unknown"}\n`);

if (failures.length > 0) {
  process.stderr.write(`\nAndroid HVSC perf budgets FAILED:\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}

if (!enforced) {
  process.stdout.write("\nNo Android HVSC perf budgets enforced; summary retained for observation only.\n");
  process.stdout.write("Set HVSC_ANDROID_BUDGET_ENFORCE=1 to enable hard failures.\n");
}
