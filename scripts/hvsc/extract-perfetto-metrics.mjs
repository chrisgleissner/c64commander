#!/usr/bin/env node

/**
 * Extract structured metrics from a Perfetto .pftrace file using trace_processor_shell.
 *
 * Usage:
 *   node scripts/hvsc/extract-perfetto-metrics.mjs \
 *     --trace=path/to/trace.pftrace \
 *     --output=path/to/extracted-metrics.json \
 *     [--sql-dir=ci/telemetry/android/perfetto-sql]
 *
 * If trace_processor_shell is not available, writes a degraded output indicating
 * manual analysis is required (load the .pftrace in ui.perfetto.dev).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split("=");
    return [key, value ?? ""];
  }),
);

const tracePath = args.get("--trace") || "";
const outputPath = args.get("--output") || "";
const sqlDir =
  args.get("--sql-dir") ||
  path.join(path.dirname(new URL(import.meta.url).pathname), "../../ci/telemetry/android/perfetto-sql");

if (!tracePath || !outputPath) {
  process.stderr.write("Usage: extract-perfetto-metrics.mjs --trace=<path> --output=<path> [--sql-dir=<path>]\n");
  process.exit(1);
}

/**
 * Find trace_processor_shell on PATH or at a well-known location.
 * Returns the resolved path or null if unavailable.
 */
function findTraceProcessor() {
  const candidates = [
    "trace_processor_shell",
    path.join(process.env.HOME || "", "perfetto/trace_processor_shell"),
    "/usr/local/bin/trace_processor_shell",
  ];
  for (const candidate of candidates) {
    try {
      const resolved = execFileSync("which", [candidate], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      if (resolved) return resolved;
    } catch {
      // not found, try next
    }
  }
  return null;
}

/**
 * Run a SQL query against a Perfetto trace via trace_processor_shell.
 * Returns parsed rows as an array of objects, or null on failure.
 */
function runQuery(traceProcessorPath, traceFile, sqlFile) {
  const sql = readFileSync(sqlFile, "utf8");
  try {
    const stdout = execFileSync(traceProcessorPath, [traceFile, "--query", sql], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseTsvOutput(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

/**
 * Parse trace_processor_shell TSV output into an array of row objects.
 */
function parseTsvOutput(tsv) {
  const lines = tsv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split("\t").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((header, i) => {
      const val = values[i] ?? "";
      const num = Number(val);
      row[header] = val !== "" && !isNaN(num) ? num : val;
    });
    return row;
  });
}

// Main extraction flow
const traceProcessorPath = findTraceProcessor();
const traceExists = existsSync(tracePath);

const result = {
  tracePath,
  traceExists,
  traceProcessorPath: traceProcessorPath ?? null,
  traceProcessorAvailable: Boolean(traceProcessorPath),
  extractedAt: new Date().toISOString(),
  queries: {},
};

if (!traceExists) {
  result.status = "no-trace";
  result.message = "Perfetto trace file not found; skipping extraction";
} else if (!traceProcessorPath) {
  result.status = "no-processor";
  result.message = "trace_processor_shell not found; load the .pftrace in ui.perfetto.dev for manual analysis";
} else {
  // Run all SQL queries from the sql directory
  const sqlFiles = existsSync(sqlDir)
    ? readdirSync(sqlDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  if (sqlFiles.length === 0) {
    result.status = "no-queries";
    result.message = "No SQL query files found in " + sqlDir;
  } else {
    let successCount = 0;
    let errorCount = 0;

    for (const sqlFile of sqlFiles) {
      const queryName = sqlFile.replace(/\.sql$/, "");
      const queryResult = runQuery(traceProcessorPath, tracePath, path.join(sqlDir, sqlFile));
      if (queryResult && queryResult.error) {
        result.queries[queryName] = {
          status: "error",
          error: queryResult.error,
          rows: [],
        };
        errorCount++;
      } else {
        result.queries[queryName] = {
          status: "ok",
          rowCount: Array.isArray(queryResult) ? queryResult.length : 0,
          rows: queryResult ?? [],
        };
        successCount++;
      }
    }

    result.status = errorCount === 0 ? "ok" : successCount > 0 ? "partial" : "error";
    result.queriesExecuted = successCount + errorCount;
    result.queriesSucceeded = successCount;
    result.queriesFailed = errorCount;
  }
}

writeFileSync(outputPath, JSON.stringify(result, null, 2));

if (result.status === "ok") {
  process.stdout.write(`Perfetto metrics extracted: ${result.queriesSucceeded} queries → ${outputPath}\n`);
} else {
  process.stdout.write(
    `Perfetto extraction status: ${result.status} — ${result.message || `${result.queriesSucceeded}/${result.queriesExecuted} queries succeeded`}\n`,
  );
}
