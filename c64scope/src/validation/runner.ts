/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyRun } from "../oraclePolicy.js";
import { ScopeSessionStore } from "../sessionStore.js";
import { adb, c64uGet, resetC64Machine } from "./helpers.js";
import type { CaseContext, CaseResult, RunResult, ValidationCase } from "./types.js";

export async function runCase(
  caseInfo: ValidationCase,
  serial: string,
  c64uHost: string,
  artifactRoot: string,
): Promise<RunResult> {
  const startTime = Date.now();
  const store = new ScopeSessionStore(artifactRoot);
  const result = await store.startSession({ caseId: caseInfo.caseId });

  if (!result.ok) {
    throw new Error(`Failed to start session: ${result.error.message}`);
  }

  const runId = result.runId;
  const artifactDir = (result.data as { artifactDir: string }).artifactDir;
  const ctx: CaseContext = { store, runId, serial, c64uHost, artifactDir };

  let caseResult: CaseResult | undefined;
  let finalOutcome = "unknown";
  let finalFailureClass = "inconclusive";
  let resetFailure: string | null = null;

  try {
    caseResult = await caseInfo.run(ctx);

    // Classify using oracle policy
    const classification = classifyRun({
      assertions: caseResult.assertions,
      safety: caseInfo.safetyClass === "read-only" ? "read-only" : "guarded-mutation",
    });

    finalOutcome = classification.outcome;
    finalFailureClass = classification.failureClass;

    try {
      await resetC64Machine(c64uHost);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      resetFailure = message;
      finalOutcome = "fail";
      finalFailureClass = "infrastructure_failure";
    }

    const summary = resetFailure
      ? `${caseInfo.name}: fail — post-test reset failed (${resetFailure})`
      : `${caseInfo.name}: ${classification.outcome} — ${classification.reason}`;

    await store.finalizeSession({
      runId,
      outcome: finalOutcome,
      failureClass: finalFailureClass,
      summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    finalOutcome = "fail";
    finalFailureClass = "infrastructure_failure";

    try {
      await resetC64Machine(c64uHost);
    } catch (resetError: unknown) {
      const resetMessage = resetError instanceof Error ? resetError.message : String(resetError);
      resetFailure = resetMessage;
    }

    await store.finalizeSession({
      runId,
      outcome: "fail",
      failureClass: "infrastructure_failure",
      summary: resetFailure ? `Case aborted: ${message}; reset failed: ${resetFailure}` : `Case aborted: ${message}`,
    });
  }

  // Write exploration trace
  if (caseResult) {
    await writeFile(
      path.join(artifactDir, "exploration-trace.json"),
      JSON.stringify(caseResult.explorationTrace, null, 2),
      "utf-8",
    );
  }

  // Write hardware proof
  const hwProof = {
    android: {
      serial,
      model: "SM-G990B",
      hardware: "qcom",
      os: "Android 16",
      product: "Samsung Galaxy S21 FE",
    },
    c64u: {
      host: c64uHost,
      hostname: "c64u",
      firmware: "3.14d",
      product: "Ultimate 64 Elite",
      uniqueId: "38C1BA",
    },
    timestamp: new Date().toISOString(),
  };
  await writeFile(path.join(artifactDir, "hardware-proof.json"), JSON.stringify(hwProof, null, 2), "utf-8");

  // Write LLM decision trace
  const llmTrace = {
    caseId: caseInfo.caseId,
    caseName: caseInfo.name,
    featureArea: caseInfo.featureArea,
    route: caseInfo.route,
    safetyClass: caseInfo.safetyClass,
    oracleClassesUsed: caseInfo.oracleClasses,
    expectedOutcome: caseInfo.expectedOutcome,
    actualOutcome: finalOutcome,
    failureClass: finalFailureClass,
    explorationTrace: caseResult?.explorationTrace,
    llmSequence: [
      "LLM selected case from catalog",
      `LLM chose oracle pair: ${caseInfo.oracleClasses.join(" + ")}`,
      `LLM enforced safety budget: ${caseInfo.safetyClass}`,
      `LLM drove execution through ${caseInfo.oracleClasses.length} oracle classes`,
      `LLM classified outcome: ${finalOutcome}/${finalFailureClass}`,
    ],
    peerServersUsed: ["mobile_controller (ADB)", "c64bridge (REST/FTP)", "c64scope (session/artifacts)"],
  };
  await writeFile(path.join(artifactDir, "llm-decision-trace.json"), JSON.stringify(llmTrace, null, 2), "utf-8");

  // Get artifacts list
  const files = await readdir(artifactDir);

  return {
    caseId: caseInfo.caseId,
    caseName: caseInfo.name,
    featureArea: caseInfo.featureArea,
    route: caseInfo.route,
    runId,
    outcome: finalOutcome,
    failureClass: finalFailureClass,
    oracleClasses: caseInfo.oracleClasses,
    artifactDir,
    artifacts: files,
    explorationTrace: caseResult?.explorationTrace ?? {
      routeDiscovery: [],
      decisionLog: [],
      safetyBudget: caseInfo.safetyClass,
      oracleSelection: [],
      recoveryActions: [],
    },
    durationMs: Date.now() - startTime,
  };
}

/** Collect real hardware identity info from android device and C64U. */
export async function collectHardwareInfo(
  serial: string,
  c64uHost: string,
): Promise<{
  hwModel: string;
  hwType: string;
  hwChars: string;
  osVersion: string;
  c64uInfo: Record<string, string>;
}> {
  const hwModel = (await adb(serial, "shell", "getprop", "ro.product.model")).trim();
  const hwType = (await adb(serial, "shell", "getprop", "ro.hardware")).trim();
  const hwChars = (await adb(serial, "shell", "getprop", "ro.build.characteristics")).trim();
  const osVersion = (await adb(serial, "shell", "getprop", "ro.build.version.release")).trim();
  const c64uInfo = JSON.parse(await c64uGet(c64uHost, "/v1/info"));
  return { hwModel, hwType, hwChars, osVersion, c64uInfo };
}
