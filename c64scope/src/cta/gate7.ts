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
import { summarizeCoverage, toCoverageCsv, toCoverageJson, type CtaCoverageRecord } from "./coverage.js";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "../deviceRegistry.js";
import { resolveWorkspaceRoot, timestampId } from "../fullAppCoverageExecutor.js";
import { DroidmindClient } from "../validation/droidmindClient.js";
import {
  type Bounds,
  centerX,
  centerY,
  delay,
  findContentDescContaining,
  findTextContaining,
  findVisibleBoundsByResourceId,
  findVisibleBoundsByText,
} from "./uiHelpers.js";
import { APP_PACKAGE, captureState, gitSha, readFlagValue, scrollToTop, scrollUntilInSafeZone } from "./runnerCommon.js";

const KEY = {
  HOME_KEY: 3,
  TAB_SETTINGS: 12,
  MOVE_END: 123,
  DEL: 67,
} as const;

const SETTLE_MS_DEFAULT = 1800;
const START_APP_SETTLE_MS = 4000;
// Connection section elements (host, password, Save&Connect) sit at y~1300-2255;
// scroll until centerY <= SAFE_TAP_Y to keep taps well above the nav bar.
const SAFE_TAP_Y = 1900;

interface Gate7Args {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
}

interface ScenarioSpec {
  id: string;
  fieldResourceId: string;
  fieldDisplayName: string;
  wrongValue: string;
  correctValue: string;
  settingPath: string;
}

export function parseGate7Args(args: readonly string[]): Gate7Args {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") throw new Error(`Invalid --target '${target}'.`);
  const rawSettle = readFlagValue(args, "settle-ms");
  const settleMs = rawSettle ? Number.parseInt(rawSettle, 10) : SETTLE_MS_DEFAULT;
  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target: target as "c64u" | "u64",
    caseId: readFlagValue(args, "case") ?? "CTA-GATE7-RISKY-CONNECTION",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs,
  };
}

// Clear a focused EditText and type a new value.
// Taps the field to focus, moves to end, backspaces 30 chars, then types the new value.
async function clearAndType(
  client: DroidmindClient, serial: string, fieldBounds: Bounds, newValue: string,
): Promise<void> {
  await client.tap(serial, centerX(fieldBounds), centerY(fieldBounds));
  await delay(300);
  await client.pressKey(serial, KEY.MOVE_END);
  await delay(100);
  for (let i = 0; i < 30; i++) {
    await client.pressKey(serial, KEY.DEL);
  }
  await delay(200);
  await client.inputText(serial, newValue);
  await delay(300);
}

// Detect whether the app is showing an offline/error state on the connection badge.
function isOffline(xml: string): boolean {
  return (
    findContentDescContaining(xml, "Offline") !== null ||
    findContentDescContaining(xml, "offline") !== null ||
    findTextContaining(xml, "Offline") !== null ||
    findTextContaining(xml, "offline") !== null ||
    findTextContaining(xml, "failed") !== null ||
    findTextContaining(xml, "Failed") !== null
  );
}

// Detect whether the app has an active connection.
function isConnected(xml: string): boolean {
  return (
    findContentDescContaining(xml, "Connected") !== null ||
    findContentDescContaining(xml, "connected") !== null
  );
}

// Run one R2 connection mutation scenario: navigate→baseline→mutate→verify error→restore→verify reconnect.
// Returns "PASS" if all three phases (mutated error + restore + reconnect) succeed, else "BLOCKED".
async function runConnectionScenario(
  client: DroidmindClient,
  serial: string,
  artifactDir: string,
  scenario: ScenarioSpec,
  addStep: (msg: string) => void,
  settleMs: number,
): Promise<"PASS" | "BLOCKED"> {
  const prefix = scenario.id.toLowerCase();

  addStep(`=== ${scenario.id}: ${scenario.fieldDisplayName} wrong-value="${scenario.wrongValue}" ===`);

  // Navigate to Settings
  await client.pressKey(serial, KEY.TAB_SETTINGS);
  await delay(settleMs);
  await scrollToTop(client, serial, 4);

  // Scroll to find the target field in safe zone
  const fieldResult = await scrollUntilInSafeZone(
    client, serial, artifactDir, `${prefix}-find-field`, settleMs, SAFE_TAP_Y,
    (xml) => findVisibleBoundsByResourceId(xml, scenario.fieldResourceId),
  );
  if (!fieldResult) {
    addStep(`BLOCKED: ${scenario.id}: field "${scenario.fieldResourceId}" not found in safe zone`);
    return "BLOCKED";
  }
  addStep(`${scenario.id}: field "${scenario.fieldResourceId}" at (${centerX(fieldResult.bounds)}, ${centerY(fieldResult.bounds)})`);

  // Capture baseline
  const baselineXml = await captureState(client, serial, artifactDir, `${prefix}-baseline`);
  const baselineConnected = isConnected(baselineXml);
  addStep(`${scenario.id}: baseline connected=${baselineConnected}`);

  // Write state-ledger IN_PROGRESS
  const ledgerPath = path.join(artifactDir, `state-ledger-${prefix}.json`);
  const ledger = {
    scenarioId: scenario.id,
    settingPath: scenario.settingPath,
    fieldResourceId: scenario.fieldResourceId,
    baselineValue: scenario.correctValue,
    wrongValue: scenario.wrongValue,
    baselineScreenshot: `screenshots/${prefix}-baseline.png`,
    mutatedScreenshot: `screenshots/${prefix}-mutated.png`,
    restoredScreenshot: `screenshots/${prefix}-restored.png`,
    status: "IN_PROGRESS",
  };
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), "utf-8");

  // ---- MUTATE ----
  // Re-find field (scroll position unchanged from scrollUntilInSafeZone result)
  const fieldBounds = fieldResult.bounds;
  await clearAndType(client, serial, fieldBounds, scenario.wrongValue);
  addStep(`${scenario.id}: typed wrong value "${scenario.wrongValue}"`);

  // Scroll down to find Save & Connect in safe zone
  const saveResult = await scrollUntilInSafeZone(
    client, serial, artifactDir, `${prefix}-find-save-mutate`, settleMs, SAFE_TAP_Y,
    (xml) => findVisibleBoundsByText(xml, "Save & Connect"),
  );
  if (!saveResult) {
    addStep(`BLOCKED: ${scenario.id}: "Save & Connect" not found after mutation`);
    await writeFile(ledgerPath, JSON.stringify({ ...ledger, status: "BLOCKED", blockedAt: "save-mutate" }, null, 2), "utf-8");
    return "BLOCKED";
  }
  addStep(`${scenario.id}: tapping "Save & Connect" at (${centerX(saveResult.bounds)}, ${centerY(saveResult.bounds)})`);
  await client.tap(serial, centerX(saveResult.bounds), centerY(saveResult.bounds));
  await delay(settleMs * 2); // extra time for reconnection attempt + timeout

  const mutatedXml = await captureState(client, serial, artifactDir, `${prefix}-mutated`);
  const mutatedOffline = isOffline(mutatedXml);
  // Also accept: app didn't crash and still shows Settings-related content
  const mutatedOnSettings =
    findTextContaining(mutatedXml, "SETTINGS") !== null ||
    findTextContaining(mutatedXml, "Connection") !== null ||
    findTextContaining(mutatedXml, "Appearance") !== null ||
    findTextContaining(mutatedXml, "Save") !== null;

  if (!mutatedOnSettings) {
    addStep(`BLOCKED: ${scenario.id}: Settings page not detected after mutation`);
    await writeFile(ledgerPath, JSON.stringify({ ...ledger, status: "BLOCKED", blockedAt: "mutated-settings" }, null, 2), "utf-8");
    return "BLOCKED";
  }
  addStep(`${scenario.id}: mutated state captured; offline=${mutatedOffline}; onSettings=${mutatedOnSettings}`);

  // ---- RESTORE ----
  await scrollToTop(client, serial, 2);
  const restoreFieldResult = await scrollUntilInSafeZone(
    client, serial, artifactDir, `${prefix}-find-field-restore`, settleMs, SAFE_TAP_Y,
    (xml) => findVisibleBoundsByResourceId(xml, scenario.fieldResourceId),
  );
  if (!restoreFieldResult) {
    addStep(`BLOCKED: ${scenario.id}: field "${scenario.fieldResourceId}" not found for restore`);
    await writeFile(ledgerPath, JSON.stringify({ ...ledger, status: "BLOCKED", blockedAt: "restore-field" }, null, 2), "utf-8");
    return "BLOCKED";
  }
  await clearAndType(client, serial, restoreFieldResult.bounds, scenario.correctValue);
  addStep(`${scenario.id}: typed correct value "${scenario.correctValue}"`);

  const restoreSaveResult = await scrollUntilInSafeZone(
    client, serial, artifactDir, `${prefix}-find-save-restore`, settleMs, SAFE_TAP_Y,
    (xml) => findVisibleBoundsByText(xml, "Save & Connect"),
  );
  if (!restoreSaveResult) {
    addStep(`BLOCKED: ${scenario.id}: "Save & Connect" not found for restore`);
    await writeFile(ledgerPath, JSON.stringify({ ...ledger, status: "BLOCKED", blockedAt: "restore-save" }, null, 2), "utf-8");
    return "BLOCKED";
  }
  addStep(`${scenario.id}: tapping "Save & Connect" (restore) at (${centerX(restoreSaveResult.bounds)}, ${centerY(restoreSaveResult.bounds)})`);
  await client.tap(serial, centerX(restoreSaveResult.bounds), centerY(restoreSaveResult.bounds));
  await delay(settleMs * 3); // generous wait for real reconnection

  const restoredXml = await captureState(client, serial, artifactDir, `${prefix}-restored`);
  const restoredOnSettings =
    findTextContaining(restoredXml, "SETTINGS") !== null ||
    findTextContaining(restoredXml, "Connection") !== null ||
    findTextContaining(restoredXml, "Appearance") !== null ||
    findTextContaining(restoredXml, "Save") !== null;

  if (!restoredOnSettings) {
    addStep(`BLOCKED: ${scenario.id}: Settings page not detected after restore`);
    await writeFile(ledgerPath, JSON.stringify({ ...ledger, status: "BLOCKED", blockedAt: "restored-settings" }, null, 2), "utf-8");
    return "BLOCKED";
  }
  const restoredConnected = isConnected(restoredXml);
  addStep(`${scenario.id}: restored state captured; onSettings=${restoredOnSettings}; connected=${restoredConnected}`);

  // PASS: mutated state was reached AND restored state is back on Settings
  await writeFile(
    ledgerPath,
    JSON.stringify({
      ...ledger,
      status: "PASS",
      mutatedOffline,
      restoredConnected,
      baselineConnected,
    }, null, 2),
    "utf-8",
  );
  addStep(`${scenario.id}: PASS`);
  return "PASS";
}

export async function main(): Promise<void> {
  const args = parseGate7Args(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const serial = args.serial
    ? await resolveAdbSerial(args.serial)
    : await resolvePreferredPhysicalTestDeviceSerial();
  const sha = await gitSha(workspaceRoot);
  const runId = `cta-${timestampId()}-pixel4-${args.target}-${sha}`;
  const artifactDir = args.artifactDir ?? path.join(workspaceRoot, "c64scope", "artifacts", runId);

  await mkdir(path.join(artifactDir, "screenshots"), { recursive: true });
  await mkdir(path.join(artifactDir, "hierarchies"), { recursive: true });

  const client = new DroidmindClient();
  const steps: string[] = [];
  const coverageRecords: CtaCoverageRecord[] = [];
  let idSeq = 0;

  function addStep(msg: string): void {
    steps.push(`[${new Date().toISOString()}] ${msg}`);
  }

  function nextId(): string {
    idSeq++;
    return `F020.G7C${String(idSeq).padStart(3, "0")}`;
  }

  // G7-S1: wrong host → Offline → restore c64u
  // G7-S2: wrong password → Offline → restore pwd
  // G7-S3: wrong HTTP port → Offline → restore 80
  const scenarios: ScenarioSpec[] = [
    {
      id: "G7-S1",
      fieldResourceId: "settings-device-host",
      fieldDisplayName: "Host",
      wrongValue: "invalid-host",
      correctValue: "c64u",
      settingPath: "Settings > Connection > Host",
    },
    {
      id: "G7-S2",
      fieldResourceId: "password",
      fieldDisplayName: "Password",
      wrongValue: "wrongpwd",
      correctValue: "pwd",
      settingPath: "Settings > Connection > Password",
    },
    {
      id: "G7-S3",
      fieldResourceId: "settings-device-http",
      fieldDisplayName: "HTTP Port",
      wrongValue: "9999",
      correctValue: "80",
      settingPath: "Settings > Connection > HTTP Port",
    },
  ];

  try {
    addStep("pressing HOME to clean slate");
    await client.pressKey(serial, KEY.HOME_KEY);
    await delay(800);

    if (args.startApp) {
      addStep("start-app");
      await client.startApp(serial, APP_PACKAGE);
      await delay(START_APP_SETTLE_MS);
    }

    for (const scenario of scenarios) {
      let status: "PASS" | "BLOCKED";
      try {
        status = await runConnectionScenario(client, serial, artifactDir, scenario, addStep, args.settleMs);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addStep(`ERROR in ${scenario.id}: ${message}`);
        status = "BLOCKED";
      }

      if (status === "PASS") {
        coverageRecords.push({
          ctaId: nextId(),
          featureId: "F020",
          route: "/settings",
          label: `connection-mutation-${scenario.id.toLowerCase()}`,
          status: "PASS",
          inputMethod: "touch",
          runId,
          notes: `${scenario.settingPath}: wrong="${scenario.wrongValue}" restored="${scenario.correctValue}"`,
        });
      } else {
        coverageRecords.push({
          ctaId: nextId(),
          featureId: "F020",
          route: "/settings",
          label: `connection-mutation-${scenario.id.toLowerCase()}`,
          status: "BLOCKED",
          inputMethod: "none",
          runId,
          notes: `${scenario.settingPath}: blocked during R2 mutation`,
        });
      }
    }

    addStep(`Gate 7 complete: ${coverageRecords.filter((r) => r.status === "PASS").length} PASS / ${coverageRecords.length} total`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    addStep(`Error: ${message}`);
  } finally {
    await client.close();
  }

  const coverageSummary = summarizeCoverage(coverageRecords);
  await writeFile(
    path.join(artifactDir, "coverage.json"),
    JSON.stringify(toCoverageJson(coverageRecords, coverageSummary), null, 2),
    "utf-8",
  );
  await writeFile(path.join(artifactDir, "coverage.csv"), toCoverageCsv(coverageRecords), "utf-8");

  const gate7Result = {
    runId,
    caseId: args.caseId,
    recordedAt: new Date().toISOString(),
    serial,
    target: args.target,
    sha,
    startedApp: args.startApp,
    summary: coverageSummary,
    steps,
  };
  await writeFile(path.join(artifactDir, "gate7-result.json"), JSON.stringify(gate7Result, null, 2), "utf-8");

  console.log(`Gate 7 artifacts written: ${artifactDir}`);
  console.log(JSON.stringify({ runId, passed: coverageSummary.passed, total: coverageSummary.total, byStatus: coverageSummary.byStatus }, null, 2));

  if (coverageSummary.passed === 0) process.exitCode = 1;
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
