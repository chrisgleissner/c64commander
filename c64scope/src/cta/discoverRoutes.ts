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
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "../deviceRegistry.js";
import { resolveWorkspaceRoot, timestampId } from "../fullAppCoverageExecutor.js";
import { DroidmindClient } from "../validation/droidmindClient.js";
import { summarizeCoverage, toCoverageCsv, toCoverageJson, type CtaCoverageRecord } from "./coverage.js";
import { runCtaCensus } from "./ctaCensus.js";
import { buildReplaySpec, recordedAction, replayCommand, type RecordedAction } from "./replay.js";
import { APP_PACKAGE, captureState, gitSha, readFlagValue } from "./runnerCommon.js";

const MAIN_ROUTES = [
  { route: "/current", label: "Home", keyCode: 8, featureId: "F003" },
  { route: "/play", label: "Play", keyCode: 9, featureId: "F010" },
  { route: "/disks", label: "Disks", keyCode: 10, featureId: "F007" },
  { route: "/config", label: "Config", keyCode: 11, featureId: "F018" },
  { route: "/settings", label: "Settings", keyCode: 12, featureId: "F020" },
  { route: "/docs", label: "Docs", keyCode: 13, featureId: "F022" },
] as const;

const START_APP_SETTLE_MS = 3000;
const DEFAULT_SETTLE_MS = 1800;
const TEST_SECRETS = ["pwd"];

interface DiscoverRoutesArgs {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
  maxScrolls?: number;
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid --${name} value '${raw}'.`);
  }
  return value;
}

export function parseDiscoverRoutesArgs(args: readonly string[]): DiscoverRoutesArgs {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") {
    throw new Error(`Invalid --target '${target}'. Expected c64u or u64.`);
  }
  const maxScrollsRaw = readFlagValue(args, "max-scrolls");
  const maxScrolls =
    maxScrollsRaw === undefined ? undefined : parsePositiveInteger(maxScrollsRaw, 20, "max-scrolls");
  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target,
    caseId: readFlagValue(args, "case") ?? "CTA-ALL-ROUTES-DISCOVER-CURRENT",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs: parsePositiveInteger(readFlagValue(args, "settle-ms"), DEFAULT_SETTLE_MS, "settle-ms"),
    maxScrolls,
  };
}

function labelFromFingerprint(fingerprint: string): string {
  return fingerprint.split("|").at(-1) || fingerprint;
}

export function coverageFromRouteFingerprints(
  runId: string,
  route: (typeof MAIN_ROUTES)[number],
  fingerprints: readonly string[],
): CtaCoverageRecord[] {
  return fingerprints.map((fingerprint, index) => ({
    ctaId: `${route.featureId}.C${String(index + 1).padStart(3, "0")}`,
    featureId: route.featureId,
    route: route.route,
    label: labelFromFingerprint(fingerprint),
    status: "CALIBRATION_ONLY",
    inputMethod: "none",
    runId,
    notes: `Runtime discovery fingerprint: ${fingerprint}`,
  }));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(): Promise<void> {
  const args = parseDiscoverRoutesArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const serial = args.serial
    ? await resolveAdbSerial(args.serial)
    : await resolvePreferredPhysicalTestDeviceSerial();
  const sha = await gitSha(workspaceRoot);
  const runId = `cta-${timestampId()}-pixel4-${args.target}-${sha}`;
  const artifactDir = args.artifactDir ?? path.join(workspaceRoot, "c64scope", "artifacts", runId);
  const client = new DroidmindClient();
  const coverageRecords: CtaCoverageRecord[] = [];
  const runtimeInventory: Record<string, string[]> = {};
  const routeResults: Array<{
    route: string;
    label: string;
    count: number;
    scrollAttempts: number;
    stopReason: string;
  }> = [];
  const actions: RecordedAction[] = [];

  try {
    await mkdir(path.join(artifactDir, "inventory"), { recursive: true });
    await mkdir(path.join(artifactDir, "screenshots"), { recursive: true });
    await mkdir(path.join(artifactDir, "hierarchies"), { recursive: true });
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

    if (args.startApp) {
      await client.pressKey(serial, 3);
      await delay(800);
      await client.startApp(serial, APP_PACKAGE);
      await delay(START_APP_SETTLE_MS);
    }

    for (const route of MAIN_ROUTES) {
      const startedAt = Date.now();
      await client.pressKey(serial, route.keyCode);
      await delay(args.settleMs);
      await captureState(client, serial, artifactDir, `discover-${route.label.toLowerCase()}-initial`, TEST_SECRETS);
      const result = await runCtaCensus(client, serial, {
        route: route.route,
        targetPackage: APP_PACKAGE,
        maxScrolls: args.maxScrolls,
      });
      runtimeInventory[route.route] = result.discovered;
      routeResults.push({
        route: route.route,
        label: route.label,
        count: result.discovered.length,
        scrollAttempts: result.scrollAttempts,
        stopReason: result.stopReason,
      });
      coverageRecords.push(...coverageFromRouteFingerprints(runId, route, result.discovered));
      actions.push(
        recordedAction({
          runId,
          suiteId: "CTA",
          caseId: args.caseId,
          stepId: `discover:${route.route}`,
          recordedAt: new Date().toISOString(),
          target: args.target,
          route: route.route,
          overlay: null,
          actionType: "discover",
          semanticTarget: route.label,
          inputMethod: "keypad",
          keyCode: route.keyCode,
          preStateSignature: route.route,
          postStateSignature: `${route.route}:discovered`,
          durationMs: Date.now() - startedAt,
          result: "PASS",
          retryCount: 0,
          screenshotRef: `screenshots/discover-${route.label.toLowerCase()}-initial.png`,
          uiHierarchyRef: `hierarchies/discover-${route.label.toLowerCase()}-initial.xml`,
          diagnosticsRef: null,
          c64scopeEventRef: null,
          error: null,
          recoveryAction: null,
        }),
      );
    }

    const coverageSummary = summarizeCoverage(coverageRecords);
    const replaySpec = buildReplaySpec({
      runId,
      caseId: args.caseId,
      requiredTarget: args.target,
      requiredAppState: { routes: MAIN_ROUTES.map((route) => route.route) },
      actions,
      assertions: ["Every main tab was entered by keypad and runtime CTA inventory was emitted."],
      cleanup: ["No cleanup required for discover-only route census."],
    });

    await writeFile(
      path.join(artifactDir, "environment.json"),
      JSON.stringify({ runId, serial, target: args.target, sha, caseId: args.caseId }, null, 2),
      "utf-8",
    );
    await writeFile(path.join(artifactDir, "inventory", "runtime.json"), JSON.stringify(runtimeInventory, null, 2), "utf-8");
    await writeFile(path.join(artifactDir, "coverage.csv"), toCoverageCsv(coverageRecords), "utf-8");
    await writeFile(
      path.join(artifactDir, "coverage.json"),
      JSON.stringify(toCoverageJson(coverageRecords, coverageSummary), null, 2),
      "utf-8",
    );
    await writeFile(path.join(artifactDir, "actions.jsonl"), `${actions.map((action) => JSON.stringify(action)).join("\n")}\n`, "utf-8");
    await writeFile(
      path.join(artifactDir, "checkpoint.jsonl"),
      `${routeResults
        .map((route) =>
          JSON.stringify({
            runId,
            caseId: args.caseId,
            stepId: `discover:${route.route}`,
            stateKey: route.route,
            completedActions: [`discover:${route.route}`],
            restored: true,
          }),
        )
        .join("\n")}\n`,
      "utf-8",
    );
    await writeFile(path.join(artifactDir, "issue-groups.json"), JSON.stringify({ generatedAt: new Date().toISOString(), groups: [] }, null, 2), "utf-8");
    await writeFile(path.join(artifactDir, "results.json"), JSON.stringify({ runId, caseId: args.caseId, routeResults, coverageSummary }, null, 2), "utf-8");
    await writeFile(path.join(artifactDir, "replays", `${args.caseId}.json`), JSON.stringify(replaySpec, null, 2), "utf-8");
    await writeFile(
      path.join(artifactDir, "runner-summary.md"),
      [
        `# Route Discovery Summary (${runId})`,
        "",
        `- Serial: ${serial}`,
        `- Target: ${args.target}`,
        `- Git SHA: ${sha}`,
        `- Routes: ${MAIN_ROUTES.map((route) => route.route).join(", ")}`,
        `- Coverage records: ${coverageRecords.length}`,
        `- Passed coverage: ${coverageSummary.passed}`,
        `- Replay command: ${replayCommand(replaySpec)}`,
      ].join("\n"),
      "utf-8",
    );

    console.log(`Route discovery artifacts written: ${artifactDir}`);
    console.log(JSON.stringify({ runId, routeResults, totalRecords: coverageRecords.length }, null, 2));
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
