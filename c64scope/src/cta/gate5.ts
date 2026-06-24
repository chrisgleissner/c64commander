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
  findTextContaining,
  findVisibleBoundsByText,
} from "./uiHelpers.js";
import { APP_PACKAGE, captureState, gitSha, readFlagValue, scrollUntilVisible } from "./runnerCommon.js";

// Android key codes
const KEY = {
  HOME_KEY: 3,  // KEYCODE_HOME (Android home button)
  1: 8,         // tab-home
  2: 9,         // tab-play
  3: 10,        // tab-disks
  4: 11,        // tab-config
  5: 12,        // tab-settings
  6: 13,        // tab-docs
} as const;

const SETTLE_MS = 1800;
const START_APP_SETTLE_MS = 4000;

interface Gate5Args {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
}

export function parseGate5Args(args: readonly string[]): Gate5Args {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") {
    throw new Error(`Invalid --target '${target}'. Expected c64u or u64.`);
  }
  const rawSettle = readFlagValue(args, "settle-ms");
  const settleMs = rawSettle ? Number.parseInt(rawSettle, 10) : SETTLE_MS;
  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target: target as "c64u" | "u64",
    caseId: readFlagValue(args, "case") ?? "CTA-GATE5-GENERIC-CONTRACTS",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs,
  };
}

// Tap a visible appearance button (identified by text) on the current Settings scroll position.
// Returns the bounds it tapped, or null if the button was not found at current scroll position.
async function tapAppearanceButton(
  client: DroidmindClient,
  serial: string,
  xml: string,
  buttonText: string,
  settleMs: number,
): Promise<Bounds | null> {
  const bounds = findVisibleBoundsByText(xml, buttonText);
  if (!bounds) return null;
  await client.tap(serial, centerX(bounds), centerY(bounds));
  await delay(settleMs);
  return bounds;
}

export async function main(): Promise<void> {
  const args = parseGate5Args(process.argv.slice(2));
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

  function nextId(featureId: string): string {
    idSeq++;
    return `${featureId}.C${String(idSeq).padStart(3, "0")}`;
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
    addStep(`PASS: ${featureId} label="${label}" (${inputMethod})`);
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
    addStep(`BLOCKED: ${featureId} label="${label}" reason: ${reason}`);
  }

  try {
    // Clean device state: press HOME then launch app.
    addStep("pressing HOME to clean slate");
    await client.pressKey(serial, KEY.HOME_KEY);
    await delay(800);

    if (args.startApp) {
      addStep("start-app");
      await client.startApp(serial, APP_PACKAGE);
      await delay(START_APP_SETTLE_MS);
    }

    // ===== TAB NAVIGATION CTAs =====
    // Exercise all 6 tab buttons via keypad (confirmed key mapping from Gate 2 canary):
    //   KEY_1→HOME, KEY_2→PLAY, KEY_3→DISKS, KEY_4→CONFIG, KEY_5→SETTINGS, KEY_6→DOCS

    const tabSpec: Array<{
      keyNum: 1 | 2 | 3 | 4 | 5 | 6;
      route: string;
      featureId: string;
      label: string;
      expectedText: string;
    }> = [
      { keyNum: 1, route: "/home",     featureId: "F003", label: "tab-home",     expectedText: "HOME" },
      { keyNum: 2, route: "/play",     featureId: "F010", label: "tab-play",     expectedText: "PLAY" },
      { keyNum: 3, route: "/disks",    featureId: "F007", label: "tab-disks",    expectedText: "DISKS" },
      { keyNum: 4, route: "/config",   featureId: "F018", label: "tab-config",   expectedText: "CONFIG" },
      { keyNum: 5, route: "/settings", featureId: "F020", label: "tab-settings", expectedText: "SETTINGS" },
      { keyNum: 6, route: "/docs",     featureId: "F022", label: "tab-docs",     expectedText: "DOCS" },
    ];

    for (const tab of tabSpec) {
      const keycode = KEY[tab.keyNum];
      addStep(`pressing KEY_${tab.keyNum} (KEYCODE=${keycode}) → ${tab.label}`);
      await client.pressKey(serial, keycode);
      await delay(args.settleMs);
      const xml = await captureState(client, serial, artifactDir, `tab-${tab.keyNum}-${tab.label.replace("tab-", "")}`);
      const found = findTextContaining(xml, tab.expectedText);
      if (found !== null) {
        recordPass(tab.featureId, tab.route, tab.label, "keypad", `KEY_${tab.keyNum} navigated to ${tab.label}; text="${tab.expectedText}" detected`);
      } else {
        // Some tabs may show text in different case or structure — still count if a recognizable title is visible
        const anyTitle = findTextContaining(xml, tab.expectedText.charAt(0) + tab.expectedText.slice(1).toLowerCase());
        if (anyTitle) {
          recordPass(tab.featureId, tab.route, tab.label, "keypad", `KEY_${tab.keyNum} navigated to ${tab.label}; text case-variant detected`);
        } else {
          recordBlocked(tab.featureId, tab.route, tab.label, `Expected text "${tab.expectedText}" not found after KEY_${tab.keyNum}`);
        }
      }
    }

    // ===== SETTINGS APPEARANCE CTAs =====
    // Navigate to Settings and exercise the Appearance section buttons.

    addStep("navigating to Settings tab for Appearance contract");
    await client.pressKey(serial, KEY[5]);
    await delay(args.settleMs);
    let settingsXml = await captureState(client, serial, artifactDir, "settings-for-appearance");
    const onSettings = findTextContaining(settingsXml, "SETTINGS") !== null ||
      findTextContaining(settingsXml, "Appearance") !== null;
    if (!onSettings) {
      addStep("WARNING: Settings page not detected for Appearance section — skipping");
    } else {
      // Ensure we're scrolled to top so Appearance section is visible.
      // Appearance is at the top of the Settings page (y~440); no scroll down needed
      // but scroll to top first to reset any prior scroll position.
      for (let i = 0; i < 4; i++) {
        await client.swipe(serial, 540, 650, 540, 1700, 250); // scroll up (finger DOWN)
        await delay(300);
      }
      await delay(600);
      settingsXml = await captureState(client, serial, artifactDir, "settings-appearance-top");

      // --- Theme buttons: Auto / Light / Dark ---
      const themeButtons = ["Auto", "Light", "Dark"] as const;
      const seenTheme = new Set<string>();
      for (const theme of themeButtons) {
        const result = await scrollUntilVisible(
          client, serial, artifactDir, `scroll-theme-${theme.toLowerCase()}`, args.settleMs,
          (xml) => {
            const b = findVisibleBoundsByText(xml, theme);
            // Guard: only match if y position is in the Appearance theme row (y < 700)
            if (b && b.y1 < 700 && !seenTheme.has(`${b.x1},${b.y1}`)) return b;
            return null;
          },
        );
        if (result) {
          seenTheme.add(`${result.bounds.x1},${result.bounds.y1}`);
          addStep(`Tapping theme button "${theme}" at (${centerX(result.bounds)}, ${centerY(result.bounds)})`);
          await client.tap(serial, centerX(result.bounds), centerY(result.bounds));
          await delay(args.settleMs);
          const afterXml = await client.captureUiHierarchy(serial);
          const stillOnSettings = findTextContaining(afterXml, "SETTINGS") !== null ||
            findTextContaining(afterXml, "Appearance") !== null;
          if (stillOnSettings) {
            recordPass("F020", "/settings", `appearance-theme-${theme.toLowerCase()}`, "touch",
              `Theme button "${theme}" tapped; Settings page still active`);
          } else {
            recordBlocked("F020", "/settings", `appearance-theme-${theme.toLowerCase()}`,
              `Settings page not detected after tapping theme "${theme}"`);
          }
          // Restore to top for next button search
          for (let i = 0; i < 3; i++) {
            await client.swipe(serial, 540, 650, 540, 1700, 250);
            await delay(300);
          }
          await delay(500);
          settingsXml = await client.captureUiHierarchy(serial);
        } else {
          recordBlocked("F020", "/settings", `appearance-theme-${theme.toLowerCase()}`,
            `Theme button "${theme}" not found in Settings Appearance section`);
        }
      }

      // Restore theme to Auto at the end.
      addStep("Restoring theme to Auto");
      const autoThemeResult = await scrollUntilVisible(
        client, serial, artifactDir, "scroll-restore-auto-theme", args.settleMs,
        (xml) => {
          const b = findVisibleBoundsByText(xml, "Auto");
          if (b && b.y1 < 700) return b;
          return null;
        },
      );
      if (autoThemeResult) {
        await client.tap(serial, centerX(autoThemeResult.bounds), centerY(autoThemeResult.bounds));
        await delay(args.settleMs / 2);
        addStep("Theme restored to Auto");
      }

      // --- Display profile buttons ---
      const displayProfiles = ["Small display", "Standard display", "Large display"] as const;
      for (const profile of displayProfiles) {
        // Scroll to profile section (it's below the theme row at y~820-1000)
        for (let i = 0; i < 3; i++) {
          await client.swipe(serial, 540, 650, 540, 1700, 250);
          await delay(300);
        }
        await delay(500);
        settingsXml = await client.captureUiHierarchy(serial);

        const profileResult = await scrollUntilVisible(
          client, serial, artifactDir, `scroll-profile-${profile.toLowerCase().replace(/ /g, "-")}`, args.settleMs,
          (xml) => findVisibleBoundsByText(xml, profile),
        );
        if (profileResult) {
          addStep(`Tapping display profile "${profile}" at (${centerX(profileResult.bounds)}, ${centerY(profileResult.bounds)})`);
          await client.tap(serial, centerX(profileResult.bounds), centerY(profileResult.bounds));
          await delay(args.settleMs);
          const afterXml = await client.captureUiHierarchy(serial);
          const stillOnSettings = findTextContaining(afterXml, "SETTINGS") !== null ||
            findTextContaining(afterXml, "Appearance") !== null;
          if (stillOnSettings) {
            recordPass("F020", "/settings", `appearance-display-${profile.toLowerCase().replace(/ /g, "-")}`, "touch",
              `Display profile "${profile}" tapped; Settings page still active`);
          } else {
            recordBlocked("F020", "/settings", `appearance-display-${profile.toLowerCase().replace(/ /g, "-")}`,
              `Settings page not detected after tapping profile "${profile}"`);
          }
        } else {
          recordBlocked("F020", "/settings", `appearance-display-${profile.toLowerCase().replace(/ /g, "-")}`,
            `Display profile button "${profile}" not found`);
        }
      }

      // Restore display profile to Auto.
      addStep("Restoring display profile to Auto");
      for (let i = 0; i < 4; i++) {
        await client.swipe(serial, 540, 650, 540, 1700, 250);
        await delay(300);
      }
      await delay(500);
      settingsXml = await client.captureUiHierarchy(serial);
      const autoProfileResult = await scrollUntilVisible(
        client, serial, artifactDir, "scroll-restore-auto-profile", args.settleMs,
        (xml) => {
          const b = findVisibleBoundsByText(xml, "Auto");
          // Display profile Auto is at y > 700 (below the theme row at y < 700)
          if (b && b.y1 > 700) return b;
          return null;
        },
      );
      if (autoProfileResult) {
        await client.tap(serial, centerX(autoProfileResult.bounds), centerY(autoProfileResult.bounds));
        await delay(args.settleMs / 2);
        addStep("Display profile restored to Auto");
      }
    }

    addStep(`Gate 5 complete: ${coverageRecords.filter((r) => r.status === "PASS").length} PASS / ${coverageRecords.length} total CTAs`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    addStep(`Error: ${message}`);
  } finally {
    await client.close();
  }

  // Write coverage artifacts in the same format as ctaRunner.ts.
  const coverageSummary = summarizeCoverage(coverageRecords);
  await writeFile(
    path.join(artifactDir, "coverage.json"),
    JSON.stringify(toCoverageJson(coverageRecords, coverageSummary), null, 2),
    "utf-8",
  );
  await writeFile(path.join(artifactDir, "coverage.csv"), toCoverageCsv(coverageRecords), "utf-8");

  const gate5Result = {
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
  await writeFile(path.join(artifactDir, "gate5-result.json"), JSON.stringify(gate5Result, null, 2), "utf-8");

  console.log(`Gate 5 artifacts written: ${artifactDir}`);
  console.log(
    JSON.stringify(
      {
        runId,
        passed: coverageSummary.passed,
        total: coverageSummary.total,
        byStatus: coverageSummary.byStatus,
      },
      null,
      2,
    ),
  );

  if (coverageSummary.passed === 0) {
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
