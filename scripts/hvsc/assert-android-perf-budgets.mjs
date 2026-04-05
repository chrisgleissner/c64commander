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
  const actualMs = target.actualMs;
  const line = `  ${budget.id} ${budget.label}: ${status} (actual=${actualMs ?? "n/a"}ms, budget=${budgetMs}ms, source=${target.source})`;
  results.push(line);
  if (enforced && status === "fail") {
    failures.push(`${budget.id}: actual ${actualMs}ms exceeds budget ${budgetMs}ms`);
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
