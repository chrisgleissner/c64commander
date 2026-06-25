/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CheckpointJournal } from "./checkpointJournal.js";
import { summarizeCoverage, toCoverageCsv, toCoverageJson, type CtaCoverageRecord } from "./coverage.js";
import { runCtaCensus } from "./ctaCensus.js";
import { reconciliationMarkdown, reconcileInventories, type InventoryItem } from "./reconciliation.js";
import { buildReplaySpec, recordedAction, replayCommand, type RecordedAction } from "./replay.js";
import { pruneSuccessfulRuns } from "./retention.js";
import { createBaselineState, type StateLedger } from "./stateLedger.js";
import { CtaStateGraph, stateKey, type CtaStateNode } from "./stateGraph.js";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "../deviceRegistry.js";
import { resolveWorkspaceRoot, timestampId } from "../fullAppCoverageExecutor.js";
import { DroidmindClient } from "../validation/droidmindClient.js";
import { APP_PACKAGE, gitSha, readFlagValue } from "./runnerCommon.js";

export interface CtaRunnerArgs {
  device?: string;
  target: "c64u" | "u64";
  discoverOnly: boolean;
  routes: string[];
  caseId: string;
  seed: number;
  keypad: boolean;
  touchParity: boolean;
  riskLevel: string;
  artifactDir?: string;
  retainSuccess: number;
  verbose: boolean;
}

function parseBooleanFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid --${name} value '${raw}'.`);
  }
  return value;
}

export function parseCtaRunnerArgs(args: readonly string[]): CtaRunnerArgs {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") {
    throw new Error(`Invalid --target value '${target}'. Expected c64u or u64.`);
  }
  const routesRaw = readFlagValue(args, "routes") ?? "/current";
  const routes = routesRaw
    .split(",")
    .map((route) => route.trim())
    .filter((route) => route.length > 0);
  if (routes.length === 0) {
    throw new Error("--routes must include at least one route.");
  }

  return {
    device: readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target,
    discoverOnly: parseBooleanFlag(args, "discover-only"),
    routes,
    caseId: readFlagValue(args, "case") ?? "CTA-DISCOVERY-001",
    seed: parsePositiveInteger(readFlagValue(args, "seed"), 64, "seed"),
    keypad: parseBooleanFlag(args, "keypad"),
    touchParity: parseBooleanFlag(args, "touch-parity"),
    riskLevel: readFlagValue(args, "risk-level") ?? "R0",
    artifactDir: readFlagValue(args, "artifact-dir"),
    retainSuccess: parsePositiveInteger(readFlagValue(args, "retain-success"), 10, "retain-success"),
    verbose: parseBooleanFlag(args, "verbose"),
  };
}

function featureForRoute(route: string): string {
  if (route === "/" || route === "/home" || route === "/current") {
    return "F003";
  }
  if (route.includes("play")) {
    return "F010";
  }
  if (route.includes("disks")) {
    return "F007";
  }
  if (route.includes("config")) {
    return "F018";
  }
  if (route.includes("settings")) {
    return "F020";
  }
  if (route.includes("docs")) {
    return "F022";
  }
  if (route.includes("diagnostics")) {
    return "F021";
  }
  return "FOUND_UNMAPPED";
}

function labelFromFingerprint(fingerprint: string): string {
  const parts = fingerprint.split("|");
  return parts.at(-1) || fingerprint;
}

function inventoryItemFromFingerprint(route: string, fingerprint: string): InventoryItem {
  const parts = fingerprint.split("|");
  return {
    fingerprint,
    route,
    role: parts.at(-2) || undefined,
    label: labelFromFingerprint(fingerprint),
  };
}

export function coverageFromFingerprints(
  runId: string,
  route: string,
  fingerprints: readonly string[],
): CtaCoverageRecord[] {
  return fingerprints.map((fingerprint, index) => ({
    ctaId: `${featureForRoute(route)}.C${String(index + 1).padStart(3, "0")}`,
    featureId: featureForRoute(route),
    route,
    label: labelFromFingerprint(fingerprint),
    status: "CALIBRATION_ONLY",
    inputMethod: "none",
    runId,
    notes: `Runtime discovery fingerprint: ${fingerprint}`,
  }));
}

export async function main(): Promise<void> {
  const args = parseCtaRunnerArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const serial = args.device ? await resolveAdbSerial(args.device) : await resolvePreferredPhysicalTestDeviceSerial();
  const sha = await gitSha(workspaceRoot);
  const runId = `cta-${timestampId()}-pixel4-${args.target}-${sha}`;
  const artifactDir = args.artifactDir ?? path.join(workspaceRoot, "c64scope", "artifacts", runId);
  const checkpoint = new CheckpointJournal(path.join(artifactDir, "checkpoint.jsonl"));
  const graph = new CtaStateGraph();
  const client = new DroidmindClient();

  try {
    await mkdir(path.join(artifactDir, "inventory"), { recursive: true });
    await mkdir(path.join(artifactDir, "replays"), { recursive: true });

    const tools = await client.listTools();
    const capabilityCheck = await client.checkCapabilities();
    await writeFile(
      path.join(artifactDir, "mcp-capabilities.json"),
      JSON.stringify({ runId, recordedAt: new Date().toISOString(), tools, check: capabilityCheck }, null, 2),
      "utf-8",
    );
    if (!capabilityCheck.satisfied) {
      throw new Error(
        `DroidMind capability preflight failed: ${capabilityCheck.missing.map((item) => item.id).join(", ")}`,
      );
    }

    const runtimeInventory: Record<string, string[]> = {};
    const runtimeItems: InventoryItem[] = [];
    const coverageRecords: CtaCoverageRecord[] = [];
    const routeResults: Array<{ route: string; count: number; stopReason: string; scrollAttempts: number }> = [];
    const recordedActions: RecordedAction[] = [];

    for (const route of args.routes) {
      const result = await runCtaCensus(client, serial, { route, targetPackage: APP_PACKAGE });
      runtimeInventory[route] = result.discovered;
      runtimeItems.push(...result.discovered.map((fingerprint) => inventoryItemFromFingerprint(route, fingerprint)));
      coverageRecords.push(...coverageFromFingerprints(runId, route, result.discovered));
      routeResults.push({
        route,
        count: result.discovered.length,
        stopReason: result.stopReason,
        scrollAttempts: result.scrollAttempts,
      });

      const node: CtaStateNode = {
        route,
        target: args.target,
        connectionState: "UNKNOWN",
        orientation: "unknown",
      };
      const currentStateKey = stateKey(node);
      graph.addNode(node);
      recordedActions.push(
        recordedAction({
          runId,
          suiteId: "CTA",
          caseId: args.caseId,
          stepId: `discover:${route}`,
          recordedAt: new Date().toISOString(),
          target: args.target,
          route,
          overlay: null,
          actionType: "discover",
          semanticTarget: `route:${route}`,
          inputMethod: "system",
          keyCode: null,
          preStateSignature: currentStateKey,
          postStateSignature: currentStateKey,
          durationMs: 0,
          result: "PASS",
          retryCount: 0,
          screenshotRef: null,
          uiHierarchyRef: null,
          diagnosticsRef: null,
          c64scopeEventRef: null,
          error: null,
          recoveryAction: null,
        }),
      );
      await checkpoint.append({
        runId,
        caseId: args.caseId,
        stepId: `discover:${route}`,
        stateKey: currentStateKey,
        completedActions: [`discover:${route}`],
        restored: true,
      });
    }

    const coverageSummary = summarizeCoverage(coverageRecords);
    const reconciliation = reconcileInventories([], runtimeItems);
    const stateLedger: StateLedger = {
      baseline: createBaselineState(),
      mutations: [],
    };
    await writeFile(
      path.join(artifactDir, "environment.json"),
      JSON.stringify({ runId, serial, target: args.target, sha }, null, 2),
      "utf-8",
    );
    await writeFile(
      path.join(artifactDir, "inventory", "runtime.json"),
      JSON.stringify(runtimeInventory, null, 2),
      "utf-8",
    );
    await writeFile(
      path.join(artifactDir, "inventory", "reconciliation.md"),
      reconciliationMarkdown(reconciliation),
      "utf-8",
    );
    await writeFile(path.join(artifactDir, "state-ledger.json"), JSON.stringify(stateLedger, null, 2), "utf-8");
    await writeFile(path.join(artifactDir, "coverage.csv"), toCoverageCsv(coverageRecords), "utf-8");
    await writeFile(
      path.join(artifactDir, "coverage.json"),
      JSON.stringify(toCoverageJson(coverageRecords, coverageSummary), null, 2),
      "utf-8",
    );
    await writeFile(path.join(artifactDir, "state-graph.json"), JSON.stringify(graph.serialize(), null, 2), "utf-8");
    await writeFile(
      path.join(artifactDir, "actions.jsonl"),
      `${recordedActions.map((action) => JSON.stringify(action)).join("\n")}\n`,
      "utf-8",
    );
    const replaySpec = buildReplaySpec({
      runId,
      caseId: args.caseId,
      requiredTarget: args.target,
      requiredAppState: { routes: args.routes },
      actions: recordedActions,
      assertions: ["Discovery action completed and runtime inventory artifact exists."],
      cleanup: ["No cleanup required for discover-only calibration action."],
    });
    await writeFile(
      path.join(artifactDir, "replays", `${args.caseId}.json`),
      JSON.stringify(replaySpec, null, 2),
      "utf-8",
    );
    await writeFile(
      path.join(artifactDir, "results.json"),
      JSON.stringify({ runId, caseId: args.caseId, routeResults, coverageSummary }, null, 2),
      "utf-8",
    );
    await writeFile(
      path.join(artifactDir, "issue-groups.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), groups: [] }, null, 2),
      "utf-8",
    );
    await writeFile(
      path.join(artifactDir, "runner-summary.md"),
      [
        `# CTA Runner Summary (${runId})`,
        "",
        `- Serial: ${serial}`,
        `- Target: ${args.target}`,
        `- Git SHA: ${sha}`,
        `- Discover only: ${args.discoverOnly}`,
        `- Routes: ${args.routes.join(", ")}`,
        `- Coverage records: ${coverageRecords.length}`,
        `- Passed coverage: ${coverageSummary.passed}`,
        `- Replay command: ${replayCommand(replaySpec)}`,
        "",
        "This runner slice performs deterministic discovery and artifact emission only. Discovered CTAs are marked CALIBRATION_ONLY until generic contracts execute.",
      ].join("\n"),
      "utf-8",
    );

    const pruned = await pruneSuccessfulRuns(path.join(workspaceRoot, "c64scope", "artifacts"), args.retainSuccess);
    console.log(`CTA runner artifacts written: ${artifactDir}`);
    console.log(JSON.stringify({ runId, routeResults, totalRecords: coverageRecords.length, pruned }, null, 2));
  } finally {
    await client.close();
  }
}

function isDirectExecution(metaUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(entry!).href === metaUrl;
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
