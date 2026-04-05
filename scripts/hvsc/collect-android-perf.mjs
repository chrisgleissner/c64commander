#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { summarizeAndroidBenchmarkArtifacts } from "./androidPerfSummary.mjs";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key, value ?? ""];
  }),
);

const loops = Number(args.get("--loops") || process.env.HVSC_ANDROID_PERF_LOOPS || "3");
const deviceId = args.get("--device-id") || process.env.DEVICE_ID || "";
const c64uTarget = args.get("--c64u-target") || process.env.C64U_TARGET || "real";
const c64uHost = args.get("--c64u-host") || process.env.C64U_HOST || "auto";
const hvscBaseUrl = args.get("--hvsc-base-url") || process.env.HVSC_BASE_URL || "";
const outFile =
  args.get("--out") ||
  process.env.HVSC_ANDROID_PERF_SUMMARY_FILE ||
  "ci-artifacts/hvsc-performance/android/android-multi-loop.json";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const benchmarkScript = path.join(rootDir, "scripts/run-hvsc-android-benchmark.sh");
const outputRoot = path.resolve(rootDir, "ci-artifacts/hvsc-performance/android");

mkdirSync(path.dirname(outFile), { recursive: true });

const allSmokeFiles = [];
const iterationResults = [];
let overallExitCode = 0;

for (let index = 0; index < loops; index += 1) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}Z-loop-${String(index + 1).padStart(2, "0")}`;
  const runArgs = [benchmarkScript, "--benchmark-run-id", runId, "--c64u-target", c64uTarget, "--c64u-host", c64uHost];
  if (deviceId) {
    runArgs.push("--device-id", deviceId);
  }
  if (hvscBaseUrl) {
    runArgs.push("--hvsc-base-url", hvscBaseUrl);
  }

  process.stderr.write(`\n=== Loop ${index + 1}/${loops} (run-id: ${runId}) ===\n`);

  const result = spawnSync("bash", runArgs, {
    stdio: "inherit",
    env: { ...process.env, OUTPUT_ROOT: outputRoot },
  });

  const runDir = path.join(outputRoot, runId);
  const smokeDir = path.join(runDir, "smoke");
  const loopSmokeFiles = existsSync(smokeDir)
    ? readdirSync(smokeDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => path.join(smokeDir, f))
    : [];

  const iterationSummary = {
    runId,
    loop: index + 1,
    exitCode: result.status ?? 1,
    smokeFileCount: loopSmokeFiles.length,
    smokeFiles: loopSmokeFiles.map((f) => path.relative(rootDir, f)),
  };
  iterationResults.push(iterationSummary);
  allSmokeFiles.push(...loopSmokeFiles);

  if (result.status !== 0) {
    overallExitCode = result.status ?? 1;
    process.stderr.write(`Loop ${index + 1} exited with status ${overallExitCode}\n`);
    if (loopSmokeFiles.length === 0) {
      process.stderr.write("No smoke files produced; aborting remaining loops.\n");
      break;
    }
  }
}

const lastRunId = iterationResults[iterationResults.length - 1]?.runId;
const lastRunDir = lastRunId ? path.join(outputRoot, lastRunId) : null;
const telemetryDir = lastRunDir ? path.join(lastRunDir, "telemetry") : null;
const perfettoDir = lastRunDir ? path.join(lastRunDir, "perfetto") : null;

const artifactSummary = summarizeAndroidBenchmarkArtifacts({
  smokeDir: allSmokeFiles,
  telemetryCsvPath: telemetryDir ? path.join(telemetryDir, "metrics.csv") : null,
  telemetryMetaPath: telemetryDir ? path.join(telemetryDir, "metadata.json") : null,
  perfettoPath: perfettoDir ? path.join(perfettoDir, "hvsc-baseline.pftrace") : null,
  perfettoLogPath: perfettoDir ? path.join(perfettoDir, "perfetto.log") : null,
});

const summary = {
  generatedAt: new Date().toISOString(),
  mode: "android-multi-loop",
  loops,
  deviceId: deviceId || "auto-detected",
  c64uTarget,
  c64uHost,
  status: overallExitCode === 0 ? "passed" : "partial",
  overallExitCode,
  iterations: iterationResults,
  ...artifactSummary,
};

writeFileSync(outFile, JSON.stringify(summary, null, 2), "utf8");
process.stdout.write(`${path.resolve(outFile)}\n`);

if (overallExitCode !== 0) {
  process.exit(overallExitCode);
}
