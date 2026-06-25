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
import {
  buildKeypadCanaryResult,
  DPAD_CANARY_STEPS,
  KEYCODES,
  SHORTCUT_CANARY_STEPS,
  summarizeKeypadCanary,
  TAB_CANARY_STEPS,
  TOUCH_CANARY_STEPS,
  type KeypadCanaryStep,
  type KeypadCanaryStepResult,
} from "./keypadCanary.js";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "../deviceRegistry.js";
import { resolveWorkspaceRoot, timestampId } from "../fullAppCoverageExecutor.js";
import { DroidmindClient } from "../validation/droidmindClient.js";
import { delay } from "./uiHelpers.js";
import { APP_PACKAGE, gitSha, readFlagValue } from "./runnerCommon.js";

const DEFAULT_SETTLE_MS = 1200;
const START_APP_SETTLE_MS = 2500;

interface KeypadCanaryArgs {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
  includeDpad: boolean;
}

function parseNonNegativeInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid --${name} value '${raw}'.`);
  }
  return value;
}

export function parseKeypadCanaryArgs(args: readonly string[]): KeypadCanaryArgs {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") {
    throw new Error(`Invalid --target value '${target}'. Expected c64u or u64.`);
  }

  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target,
    caseId: readFlagValue(args, "case") ?? "CTA-GATE2-KEYPAD-CANARY",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs: parseNonNegativeInteger(readFlagValue(args, "settle-ms"), DEFAULT_SETTLE_MS, "settle-ms"),
    includeDpad: args.includes("--include-dpad"),
  };
}

async function runStep(
  client: DroidmindClient,
  serial: string,
  artifactDir: string,
  step: KeypadCanaryStep,
  settleMs: number,
): Promise<KeypadCanaryStepResult> {
  if (step.tap) {
    await client.tap(serial, step.tap.x, step.tap.y);
  } else if (step.keyCode !== undefined) {
    await client.pressKey(serial, step.keyCode);
  } else {
    throw new Error(`Keypad canary step '${step.id}' does not define a keycode or tap target.`);
  }
  await delay(settleMs);

  const screenshot = path.join("screenshots", `${step.id}.png`);
  const hierarchy = path.join("hierarchies", `${step.id}.xml`);
  const screenshotPath = path.join(artifactDir, screenshot);
  const hierarchyPath = path.join(artifactDir, hierarchy);
  const hierarchyXml = await client.captureUiHierarchy(serial);
  await writeFile(hierarchyPath, hierarchyXml, "utf-8");
  await client.screenshotToFile(serial, screenshotPath);

  const result = buildKeypadCanaryResult(step, hierarchyXml, { screenshot, hierarchy });
  if (step.cleanupKeyCode !== undefined) {
    await client.pressKey(serial, step.cleanupKeyCode);
    await delay(settleMs);
  }
  return result;
}

export async function main(): Promise<void> {
  const args = parseKeypadCanaryArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const serial = args.serial ? await resolveAdbSerial(args.serial) : await resolvePreferredPhysicalTestDeviceSerial();
  const sha = await gitSha(workspaceRoot);
  const runId = `cta-${timestampId()}-pixel4-${args.target}-${sha}`;
  const artifactDir = args.artifactDir ?? path.join(workspaceRoot, "c64scope", "artifacts", runId);
  const client = new DroidmindClient();

  try {
    await mkdir(path.join(artifactDir, "screenshots"), { recursive: true });
    await mkdir(path.join(artifactDir, "hierarchies"), { recursive: true });

    if (args.startApp) {
      await client.startApp(serial, APP_PACKAGE);
      await delay(START_APP_SETTLE_MS);
    }

    const results: KeypadCanaryStepResult[] = [];
    for (const step of TAB_CANARY_STEPS) {
      results.push(await runStep(client, serial, artifactDir, step, args.settleMs));
    }
    for (const step of SHORTCUT_CANARY_STEPS) {
      results.push(await runStep(client, serial, artifactDir, step, args.settleMs));
    }
    if (args.includeDpad) {
      await client.pressKey(serial, KEYCODES.KEY_6);
      await delay(args.settleMs);
      for (const step of DPAD_CANARY_STEPS) {
        results.push(await runStep(client, serial, artifactDir, step, args.settleMs));
      }
    }
    await client.pressKey(serial, KEYCODES.KEY_6);
    await delay(args.settleMs);
    for (const step of TOUCH_CANARY_STEPS) {
      results.push(await runStep(client, serial, artifactDir, step, args.settleMs));
    }

    const summary = summarizeKeypadCanary(results);
    const payload = {
      runId,
      caseId: args.caseId,
      recordedAt: new Date().toISOString(),
      serial,
      target: args.target,
      gitSha: sha,
      startedApp: args.startApp,
      includeDpad: args.includeDpad,
      summary,
      results,
    };
    await writeFile(path.join(artifactDir, "keypad-canary.json"), JSON.stringify(payload, null, 2), "utf-8");
    await writeFile(
      path.join(artifactDir, "keypad-canary-summary.md"),
      [
        `# Keypad Canary Summary (${runId})`,
        "",
        `- Case: ${args.caseId}`,
        `- Serial: ${serial}`,
        `- Target: ${args.target}`,
        `- Git SHA: ${sha}`,
        `- Total steps: ${summary.total}`,
        `- Passed: ${summary.passed}`,
        `- Failed: ${summary.failed}`,
        `- Status: ${summary.status}`,
        "",
        "| Step | Kind | Key | Status | Evidence | Missing text |",
        "| --- | --- | --- | --- | --- | --- |",
        ...results.map(
          (result) =>
            `| ${result.id} | ${result.kind} | ${result.keyName} | ${result.status} | ${result.evidence.hierarchy}; ${result.evidence.screenshot} | ${result.missingText.join(", ") || "None"} |`,
        ),
      ].join("\n"),
      "utf-8",
    );

    console.log(`CTA keypad canary written: ${artifactDir}`);
    console.log(JSON.stringify({ runId, summary }, null, 2));
    if (summary.status !== "PASS") {
      process.exitCode = 1;
    }
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
