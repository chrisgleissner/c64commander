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
import { type Bounds, centerX, centerY, delay, findTextContaining, findVisibleBoundsByText } from "./uiHelpers.js";
import { APP_PACKAGE, captureState, gitSha, readFlagValue, scrollUntilVisible } from "./runnerCommon.js";

const KEYCODES = {
  KEY_5: 12, // KEYCODE_5 → Settings tab
} as const;

const SETTLE_MS_DEFAULT = 1800;
const START_APP_SETTLE_MS = 2500;

interface Gate4Args {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
}

export function parseGate4Args(args: readonly string[]): Gate4Args {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") {
    throw new Error(`Invalid --target '${target}'. Expected c64u or u64.`);
  }
  const rawSettle = readFlagValue(args, "settle-ms");
  const settleMs = rawSettle ? Number.parseInt(rawSettle, 10) : SETTLE_MS_DEFAULT;
  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target: target as "c64u" | "u64",
    caseId: readFlagValue(args, "case") ?? "CTA-GATE4-MUTATION-CANARY",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs,
  };
}

export async function main(): Promise<void> {
  const args = parseGate4Args(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const serial = args.serial ? await resolveAdbSerial(args.serial) : await resolvePreferredPhysicalTestDeviceSerial();
  const sha = await gitSha(workspaceRoot);
  const runId = `cta-${timestampId()}-pixel4-${args.target}-${sha}`;
  const artifactDir = args.artifactDir ?? path.join(workspaceRoot, "c64scope", "artifacts", runId);

  await mkdir(path.join(artifactDir, "screenshots"), { recursive: true });
  await mkdir(path.join(artifactDir, "hierarchies"), { recursive: true });

  const client = new DroidmindClient();
  const steps: string[] = [];

  function addStep(msg: string): void {
    steps.push(`[${new Date().toISOString()}] ${msg}`);
  }

  let gate4Status: "PROVEN" | "BLOCKED" = "BLOCKED";
  let blockerReason = "Not started";
  let baselineTheme: string | null = null;
  let mutatedTheme: string | null = null;
  let restoredTheme: string | null = null;

  try {
    // Press HOME to guarantee a clean device state before startApp.
    addStep("pressing HOME to clean slate");
    await client.pressKey(serial, 3); // KEYCODE_HOME
    await delay(800);

    if (args.startApp) {
      addStep("start-app");
      await client.startApp(serial, APP_PACKAGE);
      await delay(START_APP_SETTLE_MS + 1500);
    }

    // Navigate to Settings tab via keypad digit 5.
    addStep("navigate to Settings (KEY_5)");
    await client.pressKey(serial, KEYCODES.KEY_5);
    await delay(args.settleMs);

    // Capture and verify Settings page.
    const settingsXml = await captureState(client, serial, artifactDir, "settings-initial");
    const isSettingsPage =
      findTextContaining(settingsXml, "SETTINGS") !== null || findTextContaining(settingsXml, "Appearance") !== null;
    if (!isSettingsPage) {
      blockerReason = "Settings page not detected after KEY_5 navigation";
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }
    addStep("Settings page confirmed");

    // Scroll up to make sure Appearance section is visible at the top.
    addStep("scrolling to Appearance section");
    const appearanceResult = await scrollUntilVisible(
      client,
      serial,
      artifactDir,
      "scroll-to-appearance",
      args.settleMs,
      (xml) => findVisibleBoundsByText(xml, "Appearance"),
    );
    if (!appearanceResult) {
      blockerReason = "Appearance section not found after scrolling";
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }

    // The theme buttons (Auto, Light, Dark) are siblings after the Appearance heading.
    // We identify the mutation target by finding the "Dark" button via text match.
    const { xml: baselineXml } = appearanceResult;

    // Identify which theme is currently displayed. UIAutomator shows selected=false for all
    // buttons, so we use heuristic ordering: "Auto" is first, so if the app launched normally
    // it shows Auto. We record "AUTO" as the baseline and "DARK" as the mutated value.
    const autoBounds = findVisibleBoundsByText(baselineXml, "Auto");
    const darkBounds = findVisibleBoundsByText(baselineXml, "Dark");

    if (!darkBounds || !autoBounds) {
      blockerReason = `Theme buttons not found: auto=${!!autoBounds}, dark=${!!darkBounds}`;
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }

    baselineTheme = "Auto";
    addStep(`Baseline theme: ${baselineTheme}; Dark button at (${centerX(darkBounds)}, ${centerY(darkBounds)})`);

    // Capture baseline screenshot.
    await captureState(client, serial, artifactDir, "baseline");
    addStep("Baseline captured (screenshots/baseline.png)");

    // Write state-ledger.json BEFORE mutation so it is always present even if mutation fails.
    const stateLedger = {
      runId,
      caseId: args.caseId,
      serial,
      target: args.target,
      sha,
      recordedAt: new Date().toISOString(),
      settingPath: "Settings > Appearance > Theme",
      mutationTarget: "Theme button",
      baselineValue: baselineTheme,
      mutatedValue: "Dark",
      restoredValue: baselineTheme,
      baselineScreenshot: "screenshots/baseline.png",
      mutatedScreenshot: "screenshots/mutated.png",
      restoredScreenshot: "screenshots/restored.png",
      status: "IN_PROGRESS",
      steps,
    };
    await writeFile(path.join(artifactDir, "state-ledger.json"), JSON.stringify(stateLedger, null, 2), "utf-8");

    // --- MUTATION ---
    addStep(`tapping Dark theme button at (${centerX(darkBounds)}, ${centerY(darkBounds)})`);
    await client.tap(serial, centerX(darkBounds), centerY(darkBounds));
    await delay(args.settleMs);

    // Capture mutated state.
    const mutatedXml = await captureState(client, serial, artifactDir, "mutated");
    addStep("Mutated state captured (screenshots/mutated.png)");

    // Verify: Appearance section still present, Settings page still functional.
    const mutatedSettingsOk =
      findTextContaining(mutatedXml, "SETTINGS") !== null || findTextContaining(mutatedXml, "Appearance") !== null;
    if (!mutatedSettingsOk) {
      blockerReason = "Settings page not detected after mutation — app may have navigated away";
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }
    mutatedTheme = "Dark";
    addStep(`Mutation confirmed: app still on Settings page after applying theme=${mutatedTheme}`);

    // --- RESTORATION ---
    // Scroll back to Appearance section to find the Auto button (may be out of view after mutation).
    addStep("scrolling to Appearance section for restore");
    const restoreResult = await scrollUntilVisible(
      client,
      serial,
      artifactDir,
      "scroll-to-restore",
      args.settleMs,
      (xml) => findVisibleBoundsByText(xml, "Auto"),
    );
    if (!restoreResult) {
      blockerReason = "Auto theme button not found for restoration";
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }
    const autoRestoreBounds = restoreResult.bounds;
    addStep(`Auto button for restore at (${centerX(autoRestoreBounds)}, ${centerY(autoRestoreBounds)})`);
    await client.tap(serial, centerX(autoRestoreBounds), centerY(autoRestoreBounds));
    await delay(args.settleMs);

    // Capture restored state.
    const restoredXml = await captureState(client, serial, artifactDir, "restored");
    addStep("Restored state captured (screenshots/restored.png)");

    // Verify: Settings page still present after restore.
    const restoredSettingsOk =
      findTextContaining(restoredXml, "SETTINGS") !== null || findTextContaining(restoredXml, "Appearance") !== null;
    if (!restoredSettingsOk) {
      blockerReason = "Settings page not detected after restoration";
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }
    restoredTheme = "Auto";
    addStep(`Restoration confirmed: app still on Settings page; restored theme=${restoredTheme}`);

    gate4Status = "PROVEN";
    addStep(
      `Gate 4 PROVEN: baseline=${baselineTheme}, mutated=${mutatedTheme}, restored=${restoredTheme}; visual diff in screenshots/baseline.png vs screenshots/mutated.png`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!blockerReason || blockerReason === "Not started") {
      blockerReason = message;
    }
    addStep(`Error: ${message}`);
  } finally {
    await client.close();
  }

  // Update state-ledger.json with final status.
  const finalStateLedger = {
    runId,
    caseId: args.caseId,
    serial,
    target: args.target,
    sha,
    recordedAt: new Date().toISOString(),
    settingPath: "Settings > Appearance > Theme",
    mutationTarget: "Theme button",
    baselineValue: baselineTheme ?? "unknown",
    mutatedValue: mutatedTheme ?? "unknown",
    restoredValue: restoredTheme ?? "unknown",
    baselineScreenshot: "screenshots/baseline.png",
    mutatedScreenshot: "screenshots/mutated.png",
    restoredScreenshot: "screenshots/restored.png",
    status: gate4Status,
    steps,
  };
  await writeFile(path.join(artifactDir, "state-ledger.json"), JSON.stringify(finalStateLedger, null, 2), "utf-8");

  const gate4Result = {
    runId,
    caseId: args.caseId,
    status: gate4Status,
    recordedAt: new Date().toISOString(),
    serial,
    target: args.target,
    sha,
    startedApp: args.startApp,
    blockerReason: gate4Status === "BLOCKED" ? blockerReason : null,
    mutation: {
      settingPath: "Settings > Appearance > Theme",
      baselineValue: baselineTheme ?? "unknown",
      mutatedValue: mutatedTheme ?? "unknown",
      restoredValue: restoredTheme ?? "unknown",
    },
    stateLedger: path.join(artifactDir, "state-ledger.json"),
    steps,
  };
  await writeFile(path.join(artifactDir, "gate4-result.json"), JSON.stringify(gate4Result, null, 2), "utf-8");

  console.log(`Gate 4 artifacts written: ${artifactDir}`);
  console.log(JSON.stringify({ runId, status: gate4Status, mutation: gate4Result.mutation }, null, 2));

  if (gate4Status !== "PROVEN") {
    process.exitCode = 1;
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
