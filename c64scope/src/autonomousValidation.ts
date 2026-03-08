/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Autonomous agentic validation runner for C64 Commander.
 *
 * Executes 10+ independent test cases against real hardware:
 * - Samsung Galaxy Note 3 (serial prefix 211) as primary via ADB
 * - Samsung Galaxy S21 FE (serial prefix R5C) as fallback via ADB
 * - C64 Ultimate 64 Elite (c64u / 192.168.1.13) via REST + FTP
 *
 * Each case:
 * - Uses ≥2 independent oracle classes
 * - Records LLM decision traces (exploration, oracle selection, safety budget)
 * - Persists session.json + summary.md + evidence files
 * - Classifies outcome via oracle policy
 *
 * Usage:
 *   ANDROID_SERIAL=R5C C64U_HOST=192.168.1.13 node dist/autonomousValidation.js
 *   REPEAT=3 ... node dist/autonomousValidation.js   # repeatability mode
 *   C64U_HOST=192.168.1.13 node dist/autonomousValidation.js # auto-select preferred device
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "./deviceRegistry.js";
import { runPreflight } from "./preflight.js";
import { ALL_CASES } from "./validation/cases/index.js";
import { generateReport } from "./validation/report.js";
import { collectHardwareInfo, runCase } from "./validation/runner.js";
import type { RunResult } from "./validation/types.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const serialInput = process.env["ANDROID_SERIAL"];
  const serial = serialInput ? await resolveAdbSerial(serialInput) : await resolvePreferredPhysicalTestDeviceSerial();
  const c64uHost = process.env["C64U_HOST"] ?? "192.168.1.13";
  const repeatCount = parseInt(process.env["REPEAT"] ?? "1", 10);

  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║  C64 Commander — Autonomous Agentic Validation Runner  ║");
  console.log("╚════════════════════════════════════════════════════════╝");
  console.log(`  Device:  ${serial}`);
  console.log(`  C64U:    ${c64uHost}`);
  console.log(`  Repeats: ${repeatCount}`);
  console.log(`  Cases:   ${ALL_CASES.length}`);
  console.log();

  // Preflight
  console.log("=== Preflight ===");
  const preflight = await runPreflight({ deviceSerial: serial, c64uHost });
  for (const check of preflight.checks) {
    const icon = check.status === "pass" ? "✓" : "✗";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }
  if (!preflight.ready) {
    console.error("\nPreflight FAILED. Cannot proceed.");
    process.exitCode = 1;
    return;
  }

  // Verify real hardware
  console.log("\n=== Real Hardware Verification ===");
  const { hwModel, hwType, hwChars, osVersion, c64uInfo } = await collectHardwareInfo(serial, c64uHost);
  console.log(`  Android: ${hwModel} (${hwType}), Android ${osVersion}, characteristics=${hwChars}`);
  console.log(
    `  C64U:    ${c64uInfo.product}, FW ${c64uInfo.firmware_version}, hostname=${c64uInfo.hostname}, ID=${c64uInfo.unique_id}`,
  );

  // Artifact root
  const artifactRoot = path.resolve("c64scope/artifacts");
  await mkdir(artifactRoot, { recursive: true });
  console.log(`\n  Artifacts: ${artifactRoot}`);

  // Execute all cases for each repeat
  const allResults: RunResult[] = [];

  for (let rep = 1; rep <= repeatCount; rep++) {
    if (repeatCount > 1) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`  REPEAT ${rep} of ${repeatCount}`);
      console.log(`${"=".repeat(60)}`);
    }

    for (const caseInfo of ALL_CASES) {
      console.log(`\n--- [${caseInfo.id}] ${caseInfo.name} (${caseInfo.featureArea}) ---`);
      try {
        const result = await runCase(caseInfo, serial, c64uHost, artifactRoot);
        allResults.push(result);

        const expected = caseInfo.expectedOutcome;
        const correct = result.outcome === expected;
        const icon = correct ? "✓" : "✗";
        console.log(`  ${icon} Outcome: ${result.outcome} (expected: ${expected})`);
        console.log(`    Run ID:    ${result.runId}`);
        console.log(`    Oracles:   ${result.oracleClasses.join(", ")}`);
        console.log(`    Artifacts: ${result.artifacts.join(", ")}`);
        console.log(`    Duration:  ${result.durationMs}ms`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ ERROR: ${message}`);
        allResults.push({
          caseId: caseInfo.caseId,
          caseName: caseInfo.name,
          featureArea: caseInfo.featureArea,
          route: caseInfo.route,
          runId: "error",
          outcome: "error",
          failureClass: "infrastructure_failure",
          oracleClasses: caseInfo.oracleClasses,
          artifactDir: "n/a",
          artifacts: [],
          explorationTrace: {
            routeDiscovery: [],
            decisionLog: [`Error: ${message}`],
            safetyBudget: caseInfo.safetyClass,
            oracleSelection: [],
            recoveryActions: [],
          },
          durationMs: 0,
        });
      }
    }
  }

  // Write master report
  const report = generateReport(
    allResults,
    serial,
    c64uHost,
    c64uInfo,
    {
      model: hwModel,
      hardware: hwType,
      osVersion,
      characteristics: hwChars,
    },
    repeatCount,
  );
  const reportPath = path.join(artifactRoot, "validation-report.md");
  await writeFile(reportPath, report, "utf-8");

  // Write machine-readable results
  const resultsPath = path.join(artifactRoot, "validation-results.json");
  await writeFile(resultsPath, JSON.stringify(allResults, null, 2), "utf-8");

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("  VALIDATION SUMMARY");
  console.log("=".repeat(60));

  const correctCount = allResults.filter((r, i) => {
    const caseInfo = ALL_CASES[i % ALL_CASES.length]!;
    return r.outcome === caseInfo.expectedOutcome;
  }).length;

  const featureMap = new Map<string, number>();
  const oracleStats = new Map<string, number>();
  for (const r of allResults) {
    featureMap.set(r.featureArea, (featureMap.get(r.featureArea) ?? 0) + 1);
    for (const oc of r.oracleClasses) {
      oracleStats.set(oc, (oracleStats.get(oc) ?? 0) + 1);
    }
  }

  console.log(`\n  Total runs:    ${allResults.length}`);
  console.log(`  Correct:       ${correctCount}/${allResults.length}`);
  console.log(`  Pass rate:     ${((correctCount / allResults.length) * 100).toFixed(1)}%`);

  console.log("\n  Feature coverage:");
  for (const [area, count] of featureMap) {
    console.log(`    ${area}: ${count} run(s)`);
  }

  console.log("\n  Oracle usage:");
  for (const [oracle, count] of oracleStats) {
    console.log(`    ${oracle}: ${count} run(s)`);
  }

  console.log(`\n  Report:    ${reportPath}`);
  console.log(`  Results:   ${resultsPath}`);
  console.log(`  Artifacts: ${artifactRoot}/`);

  if (correctCount < allResults.length) {
    const incorrectCount = allResults.length - correctCount;
    console.error(`\n  VALIDATION INCOMPLETE: ${incorrectCount} case(s) had unexpected outcomes.`);
    process.exitCode = 1;
  } else {
    console.log("\n  ✓ ALL RUNS MATCH EXPECTED OUTCOMES");
  }
}

main().catch((error: unknown) => {
  console.error("Validation runner failed:", error);
  process.exitCode = 1;
});
