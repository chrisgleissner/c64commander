#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { summarizeAndroidBenchmarkArtifacts } from "./androidPerfSummary.mjs";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key, value ?? ""];
  }),
);

const summaryPath = args.get("--summary");
const runId = args.get("--run-id");
const deviceId = args.get("--device-id");
const target = args.get("--target");
const host = args.get("--host");
const hvscBaseUrl = args.get("--hvsc-base-url");
const maestroStatus = Number(args.get("--maestro-status") || "1");
const perfettoPath = args.get("--perfetto-trace") || "";
const perfettoLogPath = args.get("--perfetto-log") || "";
const perfettoMetricsPath = args.get("--perfetto-metrics") || "";
const smokeDir = args.get("--smoke-dir") || "";
const smokeFilesArg = args.get("--smoke-files") || "";
const telemetryDir = args.get("--telemetry-dir") || "";
const loops = Number(args.get("--loops") || "1");
const warmup = Number(args.get("--warmup") || "0");
const lane = args.get("--lane") || "full";

if (!summaryPath) {
  process.stderr.write("Missing required argument: --summary=...\n");
  process.exit(1);
}

const smokeFiles = smokeFilesArg
  ? smokeFilesArg.split(",").filter(Boolean).sort()
  : smokeDir
    ? readdirSync(smokeDir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) => path.join(smokeDir, file))
    : [];

const telemetryCsvPath = telemetryDir ? path.join(telemetryDir, "metrics.csv") : "";
const telemetryMetaPath = telemetryDir ? path.join(telemetryDir, "metadata.json") : "";

const artifactSummary = summarizeAndroidBenchmarkArtifacts({
  smokeDir: smokeFiles,
  telemetryCsvPath,
  telemetryMetaPath,
  perfettoPath,
  perfettoLogPath,
});

// Load extracted Perfetto metrics if available
let perfettoExtractedMetrics = null;
if (perfettoMetricsPath && existsSync(perfettoMetricsPath)) {
  try {
    perfettoExtractedMetrics = JSON.parse(readFileSync(perfettoMetricsPath, "utf8"));
  } catch (error) {
    process.stderr.write(`Warning: failed to read Perfetto metrics: ${error.message}\n`);
  }
}

const summary = {
  runId,
  deviceId,
  target,
  host: host || null,
  hvscBaseUrl: hvscBaseUrl || null,
  loops,
  warmup,
  lane,
  maestroStatus,
  perfettoTrace: perfettoPath ? path.relative(path.dirname(summaryPath), perfettoPath) : null,
  perfettoLog: perfettoLogPath ? path.relative(path.dirname(summaryPath), perfettoLogPath) : null,
  perfettoMetrics: perfettoMetricsPath ? path.relative(path.dirname(summaryPath), perfettoMetricsPath) : null,
  perfettoExtraction: perfettoExtractedMetrics
    ? {
        status: perfettoExtractedMetrics.status,
        traceProcessorAvailable: perfettoExtractedMetrics.traceProcessorAvailable,
        queriesExecuted: perfettoExtractedMetrics.queriesExecuted ?? 0,
        queriesSucceeded: perfettoExtractedMetrics.queriesSucceeded ?? 0,
        appTraceSections: perfettoExtractedMetrics.queries?.app_trace_sections?.rows ?? [],
        frameJank: perfettoExtractedMetrics.queries?.frame_jank?.rows ?? [],
      }
    : null,
  smokeArtifacts: smokeFiles.map((file) => path.relative(path.dirname(summaryPath), file)),
  telemetryArtifacts: telemetryDir
    ? [telemetryCsvPath, telemetryMetaPath].map((file) => path.relative(path.dirname(summaryPath), file))
    : [],
  createdAt: new Date().toISOString(),
  ...artifactSummary,
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
