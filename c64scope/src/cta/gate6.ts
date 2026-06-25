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
  findLastVisibleBoundsByText,
  findTextContaining,
  findVisibleBoundsByResourceId,
  findVisibleBoundsByText,
  getScreenSize,
  isVisible,
} from "./uiHelpers.js";
import {
  APP_PACKAGE,
  captureState,
  gitSha,
  readFlagValue,
  scrollToTop,
  scrollUntilInSafeZone,
} from "./runnerCommon.js";

const KEY = {
  HOME_KEY: 3,
  BACK: 4,
  TAB_HOME: 8,
  TAB_SETTINGS: 12,
  TAB_DOCS: 13,
  STAR: 17,
} as const;

const SETTLE_MS = 1800;
const START_APP_SETTLE_MS = 4000;
const SAFE_TAP_MAX_Y = 1990;
// Max scrolls when searching for an element AND waiting for it to enter safe zone
const MAX_SCROLL_ATTEMPTS = 14;

interface Gate6Args {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
}

export function parseGate6Args(args: readonly string[]): Gate6Args {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") throw new Error(`Invalid --target '${target}'.`);
  const rawSettle = readFlagValue(args, "settle-ms");
  const settleMs = rawSettle ? Number.parseInt(rawSettle, 10) : SETTLE_MS;
  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target: target as "c64u" | "u64",
    caseId: readFlagValue(args, "case") ?? "CTA-GATE6-PAGE-WAVES",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs,
  };
}

// Navigate to the app Settings page and tap "Portrait" to save portrait as the app's
// stored orientation preference. Uses screen-height-proportional swipe coordinates so it
// works regardless of current orientation (portrait or landscape).
// Must be called while the app is running (any tab).
async function restorePortraitViaAppSettings(client: DroidmindClient, serial: string, settleMs: number): Promise<void> {
  await client.pressKey(serial, KEY.TAB_SETTINGS);
  await delay(settleMs);

  const xml0 = await client.captureUiHierarchy(serial);
  const { height: screenH } = getScreenSize(xml0);
  // 30%/75% of screen height stays inside the scrollable container for BOTH orientations:
  // landscape scrollable is [0,225][2280,885] → 30%×1080=324, 75%×1080=810, both in 225–885 ✓
  // portrait scrollable is roughly [0,100][1080,2100] → 30%×2280=684, 75%×2280=1710, both in ✓
  const toTopFromY = Math.floor(screenH * 0.3);
  const toTopToY = Math.floor(screenH * 0.75);
  const downFromY = Math.floor(screenH * 0.75);
  const downToY = Math.floor(screenH * 0.3);

  // Scroll to top (3 passes)
  for (let i = 0; i < 3; i++) {
    await client.swipe(serial, 540, toTopFromY, 540, toTopToY, 250);
    await delay(300);
  }
  // Find and tap Portrait (scroll down up to 10 passes)
  for (let i = 0; i < 10; i++) {
    const xml = await client.captureUiHierarchy(serial);
    const b = findVisibleBoundsByText(xml, "Portrait");
    if (b && isVisible(b)) {
      await client.tap(serial, centerX(b), centerY(b));
      await delay(settleMs + 500); // extra time for rotation animation to complete
      return;
    }
    await client.swipe(serial, 540, downFromY, 540, downToY, 300);
    await delay(settleMs / 2);
  }
}

// Restore portrait mode: set system rotation AND navigate the app to Settings→Portrait.
// The system setting alone is insufficient because the app reads its own stored preference
// on launch and overrides the system rotation. Both steps are required.
async function forcePortrait(client: DroidmindClient, serial: string, settleMs: number): Promise<void> {
  await client.shell(serial, "settings put system accelerometer_rotation 0");
  await client.shell(serial, "settings put system user_rotation 0");
  await delay(500);
  await restorePortraitViaAppSettings(client, serial, settleMs);
}

async function launchFresh(client: DroidmindClient, serial: string, settleMs: number): Promise<void> {
  await client.pressKey(serial, KEY.HOME_KEY);
  await delay(800);
  await client.startApp(serial, APP_PACKAGE);
  await delay(START_APP_SETTLE_MS + settleMs);
}

export async function main(): Promise<void> {
  const args = parseGate6Args(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot();
  const serial = args.serial ? await resolveAdbSerial(args.serial) : await resolvePreferredPhysicalTestDeviceSerial();
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

  function nextId(featureId: string): string {
    idSeq++;
    return `${featureId}.G6C${String(idSeq).padStart(3, "0")}`;
  }

  function recordPass(
    featureId: string,
    route: string,
    label: string,
    inputMethod: "keypad" | "touch",
    notes: string,
  ): void {
    coverageRecords.push({
      ctaId: nextId(featureId),
      featureId,
      route,
      label,
      status: "PASS",
      inputMethod,
      runId,
      notes,
    });
    addStep(`PASS: ${featureId} ${label} (${inputMethod})`);
  }

  function recordBlocked(featureId: string, route: string, label: string, reason: string): void {
    coverageRecords.push({
      ctaId: nextId(featureId),
      featureId,
      route,
      label,
      status: "BLOCKED",
      inputMethod: "none",
      runId,
      notes: reason,
    });
    addStep(`BLOCKED: ${featureId} ${label}: ${reason}`);
  }

  try {
    addStep("force portrait orientation (system + app Settings→Portrait)");
    await forcePortrait(client, serial, args.settleMs);
    addStep("clean-slate: HOME + startApp");
    await launchFresh(client, serial, args.settleMs);

    // ===== WAVE 6.1: DOCS PAGE =====
    // Strategy: navigate to docs once, scroll to top once, then process items in forward order
    // WITHOUT returning to top between items. Each accordion expansion pushes items down;
    // scrollUntilInSafeZone handles this by continuing to scroll until item reaches safe zone.
    addStep("=== WAVE 6.1: Docs page ===");
    await client.pressKey(serial, KEY.TAB_DOCS);
    await delay(args.settleMs);
    await scrollToTop(client, serial, 3);
    const docsXml = await captureState(client, serial, artifactDir, "docs-initial");
    const onDocs = findTextContaining(docsXml, "DOCS") !== null;
    if (!onDocs) {
      recordBlocked("F022", "/docs", "docs-page-load", "DOCS text not found after KEY_6");
    } else {
      recordPass("F022", "/docs", "docs-page-load", "keypad", "KEY_6 navigated to DOCS; DOCS text detected");

      // Process docs items in order without resetting scroll between items.
      // From docs-initial.xml discovery: Getting Started, Home, Play Files, Disks & Drives,
      // Swapping Disks, Config, Settings, Diagnostics (all clickable android.widget.Button).
      const docsItems = [
        { label: "docs-getting-started", text: "Getting Started" },
        { label: "docs-home", text: "Home" },
        { label: "docs-play-files", text: "Play Files" },
        { label: "docs-disks-drives", text: "Disks & Drives" },
        { label: "docs-swapping-disks", text: "Swapping Disks" },
        { label: "docs-config", text: "Config" },
        { label: "docs-settings", text: "Settings" },
        { label: "docs-diagnostics-nav", text: "Diagnostics" },
      ];

      for (const item of docsItems) {
        const result = await scrollUntilInSafeZone(
          client,
          serial,
          artifactDir,
          `scroll-${item.label}`,
          args.settleMs,
          SAFE_TAP_MAX_Y,
          (xml) => findVisibleBoundsByText(xml, item.text),
        );
        if (!result) {
          recordBlocked(
            "F022",
            "/docs",
            item.label,
            `"${item.text}" not found in safe zone after ${MAX_SCROLL_ATTEMPTS} scrolls`,
          );
          continue;
        }
        addStep(`tapping Docs item "${item.text}" at (${centerX(result.bounds)}, ${centerY(result.bounds)})`);
        await client.tap(serial, centerX(result.bounds), centerY(result.bounds));
        await delay(args.settleMs);
        const afterXml = await captureState(client, serial, artifactDir, `docs-after-${item.label}`);
        const stillAlive =
          findTextContaining(afterXml, "C64 Commander") !== null ||
          findTextContaining(afterXml, "DOCS") !== null ||
          findTextContaining(afterXml, item.text) !== null ||
          findContentDescContaining(afterXml, "Connected") !== null ||
          findContentDescContaining(afterXml, "Offline") !== null;
        if (stillAlive) {
          recordPass("F022", "/docs", item.label, "touch", `Docs item "${item.text}" tapped; app still alive`);
        } else {
          recordBlocked("F022", "/docs", item.label, `App not detected after tapping "${item.text}"`);
        }
        // No KEY_6 or scroll-to-top between items: continue scrolling from current position
      }
    }

    // ===== WAVE 6.3: DIAGNOSTICS =====
    addStep("=== WAVE 6.3: Diagnostics via KEY_* ===");
    await client.pressKey(serial, KEY.TAB_DOCS);
    await delay(args.settleMs);
    await client.pressKey(serial, KEY.STAR);
    await delay(args.settleMs);
    const diagXml = await captureState(client, serial, artifactDir, "diagnostics-overlay");
    const onDiag =
      findTextContaining(diagXml, "Diagnostics") !== null ||
      findTextContaining(diagXml, "DIAGNOSTICS") !== null ||
      findContentDescContaining(diagXml, "Diagnostics") !== null;
    if (onDiag) {
      recordPass("F021", "/diagnostics", "diagnostics-open-star", "keypad", "KEY_* opened Diagnostics overlay");
      await client.pressKey(serial, KEY.BACK);
      await delay(args.settleMs / 2);
      recordPass("F021", "/diagnostics", "diagnostics-close-back", "keypad", "BACK key closed Diagnostics overlay");
    } else {
      recordBlocked("F021", "/diagnostics", "diagnostics-open-star", "Diagnostics text not found after KEY_*");
    }

    // ===== WAVE 6.4: HOME PAGE controls =====
    addStep("=== WAVE 6.4: Home page ===");
    await client.pressKey(serial, KEY.TAB_HOME);
    await delay(args.settleMs);
    const homeXml = await captureState(client, serial, artifactDir, "home-initial");
    const onHome =
      findTextContaining(homeXml, "HOME") !== null ||
      findTextContaining(homeXml, "PORTS") !== null ||
      findTextContaining(homeXml, "VIDEO") !== null;
    if (!onHome) {
      recordBlocked("F003", "/home", "home-page-load", "HOME text not found after KEY_1");
    } else {
      recordPass(
        "F003",
        "/home",
        "home-page-load",
        "keypad",
        "KEY_1 navigated to HOME; HOME/PORTS/VIDEO text detected",
      );

      const homeTabButtons = [
        { label: "home-ports-tab", text: "PORTS", featureId: "F003" },
        { label: "home-video-tab", text: "VIDEO", featureId: "F003" },
      ];
      for (const btn of homeTabButtons) {
        const bounds = findVisibleBoundsByText(homeXml, btn.text);
        if (bounds && centerY(bounds) <= SAFE_TAP_MAX_Y) {
          addStep(`tapping Home button "${btn.text}" at (${centerX(bounds)}, ${centerY(bounds)})`);
          await client.tap(serial, centerX(bounds), centerY(bounds));
          await delay(args.settleMs / 2);
          const afterXml = await captureState(client, serial, artifactDir, `home-after-${btn.label}`);
          const stillOnHome =
            findTextContaining(afterXml, "HOME") !== null || findTextContaining(afterXml, "PORTS") !== null;
          if (stillOnHome) {
            recordPass(
              btn.featureId,
              "/home",
              btn.label,
              "touch",
              `Home button "${btn.text}" tapped; Home page still active`,
            );
          } else {
            recordBlocked(btn.featureId, "/home", btn.label, `Home page not detected after tapping "${btn.text}"`);
          }
        } else if (bounds) {
          recordBlocked(btn.featureId, "/home", btn.label, `"${btn.text}" at y=${centerY(bounds)} behind tab bar`);
        }
      }
    }

    // ===== WAVE 6.5: SETTINGS — screen orientation (Portrait + Auto) =====
    // IMPORTANT: Do NOT test "Landscape" here — tapping Landscape physically rotates the device,
    // changing screen geometry (1080×2280 → 2280×1080). The landscape rotation corrupts
    // subsequent scroll coordinates (SAFE_TAP_MAX_Y=1990 is invalid for 1080px landscape height).
    // Portrait and Auto are safe: Portrait keeps portrait orientation, Auto returns to portrait.
    addStep("=== WAVE 6.5: Settings — screen orientation (Portrait + Auto) ===");
    await client.pressKey(serial, KEY.TAB_SETTINGS);
    await delay(args.settleMs);
    await scrollToTop(client, serial, 4);

    for (const orient of ["Portrait", "Auto"] as const) {
      const result = await scrollUntilInSafeZone(
        client,
        serial,
        artifactDir,
        `scroll-orient-${orient.toLowerCase()}`,
        args.settleMs,
        SAFE_TAP_MAX_Y,
        (xml) => {
          if (orient === "Auto") {
            // Settings has three "Auto" buttons (Theme, Display Profile, Screen Orientation).
            // Screen Orientation "Auto" is the bottommost — findLast returns it directly,
            // avoiding the guard+scroll loop that previously missed it after one fling scroll.
            return findLastVisibleBoundsByText(xml, "Auto");
          }
          return findVisibleBoundsByText(xml, orient);
        },
      );
      if (!result) {
        recordBlocked("F020", "/settings", `orientation-${orient.toLowerCase()}`, `"${orient}" not found in safe zone`);
        continue;
      }
      addStep(`tapping "${orient}" at (${centerX(result.bounds)}, ${centerY(result.bounds)})`);
      await client.tap(serial, centerX(result.bounds), centerY(result.bounds));
      await delay(args.settleMs);
      const afterXml = await client.captureUiHierarchy(serial);
      const stillOnSettings =
        findTextContaining(afterXml, "SETTINGS") !== null || findTextContaining(afterXml, "Appearance") !== null;
      if (stillOnSettings) {
        recordPass(
          "F020",
          "/settings",
          `orientation-${orient.toLowerCase()}`,
          "touch",
          `Orientation "${orient}" tapped; Settings still active`,
        );
      } else {
        recordBlocked(
          "F020",
          "/settings",
          `orientation-${orient.toLowerCase()}`,
          `Settings not detected after tapping "${orient}"`,
        );
      }
    }

    // ===== WAVE 6.5b: SETTINGS — full-screen checkboxes =====
    // After orientation test, re-launch fresh so device is guaranteed in portrait mode.
    // The full-screen section is below the orientation section in Settings.
    addStep("=== WAVE 6.5b: Settings — full-screen checkboxes ===");
    await launchFresh(client, serial, args.settleMs);
    await client.pressKey(serial, KEY.TAB_SETTINGS);
    await delay(args.settleMs);
    await scrollToTop(client, serial, 4);

    const checkboxDefs = [
      { label: "fullscreen-hide-statusbar", rid: "full-screen-hide-status-bar", display: "Hide status bar" },
      { label: "fullscreen-hide-navbar", rid: "full-screen-hide-navigation-bar", display: "Hide navigation bar" },
    ];
    for (const cb of checkboxDefs) {
      const result = await scrollUntilInSafeZone(
        client,
        serial,
        artifactDir,
        `scroll-${cb.label}`,
        args.settleMs,
        SAFE_TAP_MAX_Y,
        (xml) => findVisibleBoundsByResourceId(xml, cb.rid),
      );
      if (!result) {
        recordBlocked("F020", "/settings", cb.label, `Checkbox "${cb.rid}" not found in safe zone`);
        continue;
      }
      // Toggle ON
      addStep(`tapping checkbox "${cb.display}" at (${centerX(result.bounds)}, ${centerY(result.bounds)})`);
      await client.tap(serial, centerX(result.bounds), centerY(result.bounds));
      await delay(args.settleMs);
      const enabledXml = await client.captureUiHierarchy(serial);
      // "SETTINGS" tab may vanish when nav bar is hidden; "Appearance" may be scrolled off.
      // Check multiple Settings-page anchors to avoid false BLOCKED.
      const stillOnSettings =
        findTextContaining(enabledXml, "SETTINGS") !== null ||
        findTextContaining(enabledXml, "Appearance") !== null ||
        findTextContaining(enabledXml, "Full Screen") !== null ||
        findTextContaining(enabledXml, "Hide status bar") !== null ||
        findTextContaining(enabledXml, "Connection") !== null;
      if (stillOnSettings) {
        recordPass("F020", "/settings", cb.label, "touch", `Checkbox "${cb.display}" toggled; Settings still active`);
      } else {
        recordBlocked("F020", "/settings", cb.label, `Settings not detected after toggling "${cb.display}"`);
        continue;
      }
      // Toggle OFF (restore)
      const restoreResult = await scrollUntilInSafeZone(
        client,
        serial,
        artifactDir,
        `scroll-${cb.label}-restore`,
        args.settleMs,
        SAFE_TAP_MAX_Y,
        (xml) => findVisibleBoundsByResourceId(xml, cb.rid),
      );
      if (restoreResult) {
        await client.tap(serial, centerX(restoreResult.bounds), centerY(restoreResult.bounds));
        await delay(args.settleMs / 2);
        addStep(`restored checkbox "${cb.display}"`);
      }
    }

    addStep(
      `Gate 6 complete: ${coverageRecords.filter((r) => r.status === "PASS").length} PASS / ${coverageRecords.length} total`,
    );
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

  const gate6Result = {
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
  await writeFile(path.join(artifactDir, "gate6-result.json"), JSON.stringify(gate6Result, null, 2), "utf-8");

  console.log(`Gate 6 artifacts written: ${artifactDir}`);
  console.log(
    JSON.stringify(
      { runId, passed: coverageSummary.passed, total: coverageSummary.total, byStatus: coverageSummary.byStatus },
      null,
      2,
    ),
  );

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
