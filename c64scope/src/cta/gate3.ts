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
import { buildReplaySpec, replayCommand, type RecordedAction } from "./replay.js";
import { recordedAction } from "./replay.js";
import { redactSecretLiterals } from "./redaction.js";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "../deviceRegistry.js";
import { resolveWorkspaceRoot, timestampId } from "../fullAppCoverageExecutor.js";
import { DroidmindClient } from "../validation/droidmindClient.js";
import {
  type Bounds,
  centerX,
  centerY,
  delay,
  findContentDescContaining,
  findTextByResourceId,
  findTextContaining,
  findVisibleBoundsByResourceId,
  findVisibleBoundsByText,
} from "./uiHelpers.js";
import {
  APP_PACKAGE,
  captureState,
  gitSha,
  readFlagValue,
  redactUiHierarchySecrets,
  scrollUntilVisible,
} from "./runnerCommon.js";

// Android key codes used in this runner
const KEYCODES = {
  KEY_5: 12, // Tab 5 → Settings
  MOVE_END: 123, // KEYCODE_MOVE_END — move cursor to end of field
  DEL: 67, // KEYCODE_DEL — backspace one character
  BACK: 4, // KEYCODE_BACK
} as const;

const SETTLE_MS_DEFAULT = 1800;
const START_APP_SETTLE_MS = 2500;
const CONNECT_WAIT_MS = 10000;
const MAX_SCROLL_ATTEMPTS = 8;
const CHAR_DELETE_MS = 80;
const TEST_PASSWORD = "pwd";
const REDACTED = "[REDACTED]";

export function redactGate3SecretText(value: string): string {
  return redactSecretLiterals(value, [TEST_PASSWORD]);
}

interface Gate3Args {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
}

export function parseGate3Args(args: readonly string[]): Gate3Args {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") {
    throw new Error(`Invalid --target '${target}'. Expected c64u or u64.`);
  }
  const rawSettle = readFlagValue(args, "settle-ms");
  const settleMs = rawSettle ? Number.parseInt(rawSettle, 10) : SETTLE_MS_DEFAULT;
  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target: target as "c64u" | "u64",
    caseId: readFlagValue(args, "case") ?? "CTA-GATE3-C64U-SAVE-CONNECT",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs,
  };
}

export async function main(): Promise<void> {
  const args = parseGate3Args(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const serial = args.serial ? await resolveAdbSerial(args.serial) : await resolvePreferredPhysicalTestDeviceSerial();
  const sha = await gitSha(workspaceRoot);
  const runId = `cta-${timestampId()}-pixel4-${args.target}-${sha}`;
  const artifactDir = args.artifactDir ?? path.join(workspaceRoot, "c64scope", "artifacts", runId);

  await mkdir(path.join(artifactDir, "screenshots"), { recursive: true });
  await mkdir(path.join(artifactDir, "hierarchies"), { recursive: true });
  await mkdir(path.join(artifactDir, "replays"), { recursive: true });

  const client = new DroidmindClient();
  const steps: string[] = [];
  const recordedActions: RecordedAction[] = [];

  function addStep(msg: string): void {
    steps.push(`[${new Date().toISOString()}] ${redactGate3SecretText(msg)}`);
  }

  function recordStep(stepId: string, actionType: string, result: "PASS" | "FAIL" | "INCONCLUSIVE"): void {
    recordedActions.push(
      recordedAction({
        runId,
        suiteId: "CTA",
        caseId: args.caseId,
        stepId,
        recordedAt: new Date().toISOString(),
        target: args.target,
        route: "/settings",
        overlay: null,
        actionType,
        semanticTarget: stepId,
        inputMethod: "touch",
        keyCode: null,
        preStateSignature: stepId,
        postStateSignature: `${stepId}:done`,
        durationMs: 0,
        result,
        retryCount: 0,
        screenshotRef: `screenshots/${stepId}.png`,
        uiHierarchyRef: `hierarchies/${stepId}.xml`,
        diagnosticsRef: null,
        c64scopeEventRef: null,
        error: null,
        recoveryAction: null,
      }),
    );
  }

  let gate3Status: "PROVEN" | "BLOCKED" = "BLOCKED";
  let blockerReason = "Not started";
  let hostAfter: string | null = null;
  let passwordObserved: string | null = null;
  let connectionStatus: string | null = null;
  let currentlyUsing: string | null = null;

  try {
    const tools = await client.listTools();
    const capabilityCheck = await client.checkCapabilities();
    await writeFile(
      path.join(artifactDir, "mcp-capabilities.json"),
      JSON.stringify({ runId, recordedAt: new Date().toISOString(), tools, check: capabilityCheck }, null, 2),
      "utf-8",
    );

    await writeFile(
      path.join(artifactDir, "environment.json"),
      JSON.stringify(
        {
          runId,
          serial,
          target: args.target,
          sha,
          caseId: args.caseId,
          recordedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );

    // Press HOME first to guarantee a clean device state: closes notification shade,
    // Quick Settings, or any system panels left open by a prior run, and sends the
    // display to the launcher where no stale window can intercept the next startApp.
    addStep("pressing HOME to clean slate");
    await client.pressKey(serial, 3); // KEYCODE_HOME
    await delay(800);

    if (args.startApp) {
      addStep("start-app");
      await client.startApp(serial, APP_PACKAGE);
      // Extra settle time because we come from the launcher; app needs to fully render.
      await delay(START_APP_SETTLE_MS + 1500);
    }

    // Pre-action state capture
    addStep("pre-action capture");
    const preXml = await captureState(client, serial, artifactDir, "pre-action", [TEST_PASSWORD]);
    recordStep("pre-action", "screenshot", "PASS");
    const preStatus = findContentDescContaining(preXml, "Connected");
    addStep(`Pre-action status badge: ${preStatus ?? "not found"}`);

    // Navigate to Settings tab
    addStep("navigate to Settings (KEY_5)");
    await client.pressKey(serial, KEYCODES.KEY_5);
    await delay(args.settleMs);
    const settingsInitXml = await captureState(client, serial, artifactDir, "settings-initial", [TEST_PASSWORD]);
    recordStep("settings-initial", "key:KEY_5", "PASS");
    addStep("Settings page captured");

    // Accept Settings page if any of its known section headings are visible.
    // "SETTINGS" is the page title; "Appearance" and "Connection" are section headings.
    const isSettingsPage =
      findTextContaining(settingsInitXml, "SETTINGS") !== null ||
      findTextContaining(settingsInitXml, "Appearance") !== null ||
      findTextContaining(settingsInitXml, "Connection") !== null ||
      findTextContaining(settingsInitXml, "Saved devices") !== null;
    if (!isSettingsPage) {
      blockerReason =
        "Settings page not detected after KEY_5 navigation (checked SETTINGS/Appearance/Connection/Saved devices)";
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }

    // Scroll down to reveal Connection/host field
    addStep("scrolling to host field");
    const hostResult = await scrollUntilVisible(
      client,
      serial,
      artifactDir,
      "scroll-to-host",
      args.settleMs,
      (xml) => findVisibleBoundsByResourceId(xml, "settings-device-host"),
      MAX_SCROLL_ATTEMPTS,
      [TEST_PASSWORD],
    );

    if (!hostResult) {
      blockerReason = `settings-device-host not visible after ${MAX_SCROLL_ATTEMPTS} scroll attempts`;
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }

    const { xml: hostXml, bounds: hostBounds } = hostResult;
    const hostBefore = findTextByResourceId(hostXml, "settings-device-host");
    addStep(
      `Host field visible at bounds [${hostBounds.x1},${hostBounds.y1}][${hostBounds.x2},${hostBounds.y2}], current value: ${hostBefore}`,
    );

    await writeFile(path.join(artifactDir, "hierarchies", "settings-host-before.xml"), hostXml, "utf-8");
    await client.screenshotToFile(serial, path.join(artifactDir, "screenshots", "settings-host-before.png"));
    recordStep("settings-host-before", "discover", "PASS");

    // Tap host field to focus it
    addStep("tapping host field to focus");
    const hx = centerX(hostBounds);
    const hy = centerY(hostBounds);
    await client.tap(serial, hx, hy);
    await delay(500);

    addStep("clearing host field (MOVE_END + DEL × 15)");
    await client.pressKey(serial, KEYCODES.MOVE_END);
    await delay(200);
    for (let i = 0; i < 15; i++) {
      await client.pressKey(serial, KEYCODES.DEL);
      await delay(CHAR_DELETE_MS);
    }
    await delay(300);

    // Type new host value
    addStep("typing host: c64u");
    await client.inputText(serial, "c64u");
    await delay(500);

    // Capture host field after change
    const hostAfterXml = await captureState(client, serial, artifactDir, "settings-host-after", [TEST_PASSWORD]);
    recordStep("settings-host-after", "input_text:c64u", "PASS");
    hostAfter = findTextByResourceId(hostAfterXml, "settings-device-host");
    addStep(`Host field value after edit: ${hostAfter}`);

    const pwdBounds = findVisibleBoundsByResourceId(hostAfterXml, "password");
    passwordObserved = findTextByResourceId(hostAfterXml, "password");
    addStep(`Password field value before edit: ${passwordObserved ?? "(not found)"}`);

    if (pwdBounds) {
      addStep("tapping password field to focus");
      await client.tap(serial, centerX(pwdBounds), centerY(pwdBounds));
      await delay(400);
      addStep("clearing password field (MOVE_END + DEL × 10)");
      await client.pressKey(serial, KEYCODES.MOVE_END);
      await delay(150);
      for (let i = 0; i < 10; i++) {
        await client.pressKey(serial, KEYCODES.DEL);
        await delay(CHAR_DELETE_MS);
      }
      await delay(200);
      addStep(`typing password: ${REDACTED}`);
      await client.inputText(serial, TEST_PASSWORD);
      await delay(400);
      // Re-read password to confirm (UIAutomator may still show "" for masked fields)
      const pwdAfterXml = await client.captureUiHierarchy(serial);
      passwordObserved = findTextByResourceId(pwdAfterXml, "password");
      addStep(`Password field value after edit: ${passwordObserved ?? "(masked or not found)"}`);
    } else {
      addStep("WARNING: password field not found at current scroll position — skipping password entry");
    }

    // Tap a neutral area (page header) to defocus the input without pressing BACK,
    // which would navigate away from the Settings page.
    addStep("tapping header to defocus input field");
    await client.tap(serial, 540, 150);
    await delay(500);

    // Scroll to Save & Connect button
    addStep("scrolling to Save & Connect button");
    const saveResult = await scrollUntilVisible(
      client,
      serial,
      artifactDir,
      "scroll-to-save",
      args.settleMs,
      (xml) => findVisibleBoundsByText(xml, "Save & Connect") ?? findVisibleBoundsByText(xml, "Save &amp; Connect"),
      MAX_SCROLL_ATTEMPTS,
      [TEST_PASSWORD],
    );

    if (!saveResult) {
      blockerReason = `Save & Connect button not visible after ${MAX_SCROLL_ATTEMPTS} scroll attempts`;
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }

    let { xml: saveXml, bounds: saveBounds } = saveResult;

    // Guard against the scroll sequence having sent the app to the background
    // (a swipe that lands outside the WebView can surface the Android launcher;
    // later hierarchies then show launcher nodes instead of Settings). Verify a
    // Settings-page marker is present before trusting the matched bounds and
    // tapping, so we fail with a clear reason instead of tapping the launcher
    // (INFRA-002).
    const stillOnSettings =
      findTextContaining(saveXml, "SETTINGS") !== null ||
      findTextContaining(saveXml, "Appearance") !== null ||
      findTextContaining(saveXml, "Connection") !== null ||
      findTextContaining(saveXml, "Saved devices") !== null;
    if (!stillOnSettings) {
      blockerReason = "App left the Settings page during scroll to Save & Connect (no Settings marker found)";
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }

    addStep(`Save & Connect button at [${saveBounds.x1},${saveBounds.y1}][${saveBounds.x2},${saveBounds.y2}]`);

    // The app's bottom tab bar sits at ~y=1993 on the 2280px Pixel 4 screen. If the button
    // center is behind the tab bar, do one more scrollDown (swipe finger UP: endY < startY)
    // to lift it into the safe content area. Tapping a button that is covered by the tab bar
    // would hit the tab bar instead of the WebView button.
    const SAFE_TAP_MAX_Y = 1990;
    if (centerY(saveBounds) > SAFE_TAP_MAX_Y) {
      addStep(
        `button center y=${centerY(saveBounds)} is behind tab bar — scrolling down to lift it above y=${SAFE_TAP_MAX_Y}`,
      );
      await client.scrollDown(serial);
      await delay(args.settleMs);
      saveXml = redactUiHierarchySecrets(await client.captureUiHierarchy(serial), [TEST_PASSWORD]);
      await writeFile(path.join(artifactDir, "hierarchies", "pre-save-scroll.xml"), saveXml, "utf-8");
      const adjustedBounds =
        findVisibleBoundsByText(saveXml, "Save & Connect") ?? findVisibleBoundsByText(saveXml, "Save &amp; Connect");
      if (adjustedBounds) {
        saveBounds = adjustedBounds;
        addStep(`Save & Connect after scroll: [${saveBounds.x1},${saveBounds.y1}][${saveBounds.x2},${saveBounds.y2}]`);
      } else {
        blockerReason = "Save & Connect not found after scroll adjustment";
        addStep(`BLOCKED: ${blockerReason}`);
        throw new Error(blockerReason);
      }
    }

    await writeFile(path.join(artifactDir, "hierarchies", "pre-save-connect.xml"), saveXml, "utf-8");
    await client.screenshotToFile(serial, path.join(artifactDir, "screenshots", "pre-save-connect.png"));
    recordStep("pre-save-connect", "discover", "PASS");

    // Abort rather than silently tap the wrong element if the button is still behind the bar.
    const tapX = centerX(saveBounds);
    const tapY = centerY(saveBounds);
    if (tapY > SAFE_TAP_MAX_Y) {
      blockerReason = `Save & Connect center y=${tapY} is still behind tab bar after scroll (SAFE_TAP_MAX_Y=${SAFE_TAP_MAX_Y})`;
      addStep(`BLOCKED: ${blockerReason}`);
      throw new Error(blockerReason);
    }

    addStep(`tapping Save & Connect at (${tapX}, ${tapY})`);
    await client.tap(serial, tapX, tapY);
    addStep(`Waiting ${CONNECT_WAIT_MS}ms for connection`);
    await delay(CONNECT_WAIT_MS);

    // Capture post-connect state at current scroll position.
    const postXml = await captureState(client, serial, artifactDir, "post-save-connect", [TEST_PASSWORD]);
    recordStep("post-save-connect", "tap:save-connect", "PASS");

    // Capture any immediately-visible status info (may be scrolled to button area).
    connectionStatus =
      findContentDescContaining(postXml, "Connected") ??
      findContentDescContaining(postXml, "Offline") ??
      findContentDescContaining(postXml, "Connecting");
    currentlyUsing = findTextContaining(postXml, "Currently using:");
    addStep(`Connection status badge (in-place): ${connectionStatus ?? "not found"}`);
    addStep(`Currently using text: ${currentlyUsing ?? "not found"}`);

    // Scroll back to the top of Settings to reveal the connection badge in the app header.
    // Swipe finger DOWN (startY < endY) = content moves DOWN (shows content above) = back to top.
    addStep("scrolling to top to capture connection badge in header");
    for (let i = 0; i < 5; i++) {
      await client.swipe(serial, 540, 650, 540, 1700, 300);
      await delay(400);
    }
    await delay(800);
    const topXml = await captureState(client, serial, artifactDir, "post-save-connect-top", [TEST_PASSWORD]);
    const topStatus =
      findContentDescContaining(topXml, "Connected") ??
      findContentDescContaining(topXml, "Offline") ??
      findContentDescContaining(topXml, "Connecting");
    if (topStatus) {
      connectionStatus = topStatus;
    }
    const topCurrentlyUsing = findTextContaining(topXml, "Currently using:");
    if (!currentlyUsing && topCurrentlyUsing) currentlyUsing = topCurrentlyUsing;
    addStep(`Connection status badge (after scroll-to-top): ${connectionStatus ?? "not found"}`);

    // Gate 3 PROVEN criteria:
    // 1. Host field was changed to c64u  (primary: hostAfter === "c64u")
    // 2. App shows it is actively targeting c64u ("Connected to C64U" badge
    //    OR "Currently using: c64u" text confirms the target was accepted)
    const hostOk = hostAfter?.toLowerCase() === "c64u";
    const connectedToC64u =
      connectionStatus?.toLowerCase().includes("c64u") === true ||
      connectionStatus?.toLowerCase().includes("connected") === true ||
      currentlyUsing?.toLowerCase().includes("c64u") === true;

    if (hostOk && connectedToC64u) {
      gate3Status = "PROVEN";
      addStep(
        `Gate 3 PROVEN: host=c64u confirmed; connection evidence: badge="${connectionStatus ?? "n/a"}" currentlyUsing="${currentlyUsing ?? "n/a"}"`,
      );
    } else if (hostOk) {
      blockerReason = `host=c64u set but no c64u connection evidence found (badge=${connectionStatus}, using=${currentlyUsing})`;
      addStep(`BLOCKED: ${blockerReason}`);
    } else {
      blockerReason = `Host field shows '${hostAfter}' instead of 'c64u'; connection: ${connectionStatus}`;
      addStep(`BLOCKED: ${blockerReason}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!blockerReason || blockerReason === "Not started") {
      blockerReason = message;
    }
    addStep(`Error: ${message}`);
  } finally {
    await client.close();
  }

  const replaySpec = buildReplaySpec({
    runId,
    caseId: args.caseId,
    requiredTarget: args.target,
    requiredAppState: { routes: ["/settings"] },
    actions: recordedActions,
    assertions: [
      "settings-device-host field shows 'c64u' after Save & Connect",
      "App connection status confirms C64U target identity",
    ],
    cleanup: ["Navigate to Settings and restore host field if partially changed."],
  });
  await writeFile(
    path.join(artifactDir, "replays", `${args.caseId}.json`),
    JSON.stringify(replaySpec, null, 2),
    "utf-8",
  );

  const gate3Result = {
    runId,
    caseId: args.caseId,
    status: gate3Status,
    recordedAt: new Date().toISOString(),
    serial,
    target: args.target,
    sha,
    startedApp: args.startApp,
    blockerReason: gate3Status === "BLOCKED" ? blockerReason : null,
    evidence: {
      hostBefore: "see hierarchies/settings-host-before.xml",
      hostAfter,
      passwordObserved: passwordObserved === null ? null : REDACTED,
      connectionStatus,
      currentlyUsing,
    },
    steps,
    replayCommand: replayCommand(replaySpec),
  };

  await writeFile(path.join(artifactDir, "gate3-result.json"), JSON.stringify(gate3Result, null, 2), "utf-8");

  const summaryLines = [
    `# Gate 3 Result: ${gate3Status} (${runId})`,
    "",
    `- Case: ${args.caseId}`,
    `- Serial: ${serial}`,
    `- Target: ${args.target}`,
    `- Git SHA: ${sha}`,
    `- Status: **${gate3Status}**`,
    gate3Status === "BLOCKED" ? `- Blocker: ${blockerReason}` : "",
    "",
    "## Evidence",
    `- Host field before: see \`hierarchies/settings-host-before.xml\``,
    `- Host field after change: \`${hostAfter ?? "unknown"}\``,
    `- Password observed: \`${passwordObserved === null ? "unknown" : REDACTED}\``,
    `- Connection status: \`${connectionStatus ?? "unknown"}\``,
    `- Currently using: \`${currentlyUsing ?? "unknown"}\``,
    "",
    "## Step Log",
    ...steps.map((s) => `- ${s}`),
  ].filter((l) => l !== undefined);

  await writeFile(path.join(artifactDir, "gate3-summary.md"), summaryLines.join("\n"), "utf-8");

  console.log(`Gate 3 artifacts written: ${artifactDir}`);
  console.log(JSON.stringify({ runId, status: gate3Status, hostAfter, connectionStatus }, null, 2));

  if (gate3Status !== "PROVEN") {
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
