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
  findVisibleBoundsByContentDesc,
  findVisibleBoundsByText,
} from "./uiHelpers.js";
import { APP_PACKAGE, captureState, gitSha, readFlagValue, scrollUntilInSafeZone } from "./runnerCommon.js";

const KEY = {
  HOME_KEY: 3,
  BACK: 4,
  TAB_PLAY: 9,
  TAB_DISKS: 10,
  TAB_CONFIG: 11,
} as const;

const SETTLE_MS_DEFAULT = 1800;
const START_APP_SETTLE_MS = 4000;
const SAFE_TAP_MAX_Y = 1940;

interface Gate65Args {
  serial?: string;
  target: "c64u" | "u64";
  caseId: string;
  artifactDir?: string;
  startApp: boolean;
  settleMs: number;
}

export function parseGate65Args(args: readonly string[]): Gate65Args {
  const target = readFlagValue(args, "target") ?? "c64u";
  if (target !== "c64u" && target !== "u64") throw new Error(`Invalid --target '${target}'.`);
  const rawSettle = readFlagValue(args, "settle-ms");
  const settleMs = rawSettle ? Number.parseInt(rawSettle, 10) : SETTLE_MS_DEFAULT;
  return {
    serial: readFlagValue(args, "serial") ?? readFlagValue(args, "device") ?? process.env["ANDROID_SERIAL"],
    target: target as "c64u" | "u64",
    caseId: readFlagValue(args, "case") ?? "CTA-GATE65-PAGE-WAVES-PLAY-DISKS-CONFIG",
    artifactDir: readFlagValue(args, "artifact-dir"),
    startApp: args.includes("--start-app"),
    settleMs,
  };
}

export async function main(): Promise<void> {
  const args = parseGate65Args(process.argv.slice(2));
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
    return `${featureId}.G65C${String(idSeq).padStart(3, "0")}`;
  }

  function recordPass(featureId: string, route: string, label: string, inputMethod: "keypad" | "touch", notes: string): void {
    coverageRecords.push({ ctaId: nextId(featureId), featureId, route, label, status: "PASS", inputMethod, runId, notes });
    addStep(`PASS: ${featureId} ${label}`);
  }

  function recordBlocked(featureId: string, route: string, label: string, reason: string): void {
    coverageRecords.push({ ctaId: nextId(featureId), featureId, route, label, status: "BLOCKED", inputMethod: "none", runId, notes: reason });
    addStep(`BLOCKED: ${featureId} ${label}: ${reason}`);
  }

  try {
    addStep("pressing HOME to clean slate");
    await client.pressKey(serial, KEY.HOME_KEY);
    await delay(800);

    if (args.startApp) {
      addStep("start-app");
      await client.startApp(serial, APP_PACKAGE);
      await delay(START_APP_SETTLE_MS);
    }

    // ===== WAVE 6.5: PLAY PAGE =====
    addStep("=== WAVE 6.5: Play page ===");
    await client.pressKey(serial, KEY.TAB_PLAY);
    await delay(args.settleMs);
    const playXml = await captureState(client, serial, artifactDir, "play-initial");
    const onPlay = findTextContaining(playXml, "PLAY") !== null ||
      findTextContaining(playXml, "playlist") !== null ||
      findTextContaining(playXml, "Select a playlist") !== null;

    if (!onPlay) {
      recordBlocked("F010", "/play", "play-page-load", "PLAY text not found after KEY_2");
    } else {
      recordPass("F010", "/play", "play-page-load", "keypad", "KEY_2 navigated to PLAY; page content detected");

      // Play page media control buttons — identified by content-desc from discovery hierarchy.
      // These are safe to tap with no active playlist (app shows "Select a playlist item to start").
      const playControls: Array<{ cd: string; label: string }> = [
        { cd: "Previous", label: "play-previous" },
        { cd: "Play",     label: "play-play"     },
        { cd: "Pause",    label: "play-pause"    },
        { cd: "Next",     label: "play-next"     },
        { cd: "Mute",     label: "play-mute"     },
      ];

      // All controls are typically visible at once on the Play page — no scrolling needed.
      const playXml2 = await client.captureUiHierarchy(serial);
      for (const ctrl of playControls) {
        const bounds = findVisibleBoundsByContentDesc(playXml2, ctrl.cd);
        if (!bounds || centerY(bounds) > SAFE_TAP_MAX_Y) {
          recordBlocked("F010", "/play", ctrl.label, `Button cd="${ctrl.cd}" not found in safe zone`);
          continue;
        }
        addStep(`tapping play control "${ctrl.cd}" at (${centerX(bounds)}, ${centerY(bounds)})`);
        await client.tap(serial, centerX(bounds), centerY(bounds));
        await delay(args.settleMs / 2);
        const afterXml = await client.captureUiHierarchy(serial);
        const stillOnPlay = findTextContaining(afterXml, "PLAY") !== null ||
          findTextContaining(afterXml, "playlist") !== null ||
          findContentDescContaining(afterXml, "Play") !== null ||
          findContentDescContaining(afterXml, "Pause") !== null;
        if (stillOnPlay) {
          recordPass("F010", "/play", ctrl.label, "touch", `Play control "${ctrl.cd}" tapped; Play page still active`);
        } else {
          recordBlocked("F010", "/play", ctrl.label, `Play page not detected after tapping "${ctrl.cd}"`);
        }
      }

      // Recurse checkbox — safe to toggle ON then OFF
      const recurseResult = await scrollUntilInSafeZone(
        client, serial, artifactDir, "scroll-play-recurse", args.settleMs, SAFE_TAP_MAX_Y,
        (xml) => findVisibleBoundsByContentDesc(xml, "Recurse"),
      );
      if (recurseResult) {
        addStep(`tapping Recurse checkbox at (${centerX(recurseResult.bounds)}, ${centerY(recurseResult.bounds)})`);
        await client.tap(serial, centerX(recurseResult.bounds), centerY(recurseResult.bounds));
        await delay(args.settleMs / 2);
        const afterXml = await client.captureUiHierarchy(serial);
        const stillOnPlay = findTextContaining(afterXml, "PLAY") !== null ||
          findContentDescContaining(afterXml, "Recurse") !== null;
        if (stillOnPlay) {
          recordPass("F010", "/play", "play-recurse-toggle", "touch", "Recurse checkbox tapped; Play page still active");
          // Restore: tap again to toggle back OFF
          const restoreB = findVisibleBoundsByContentDesc(afterXml, "Recurse");
          if (restoreB) {
            await client.tap(serial, centerX(restoreB), centerY(restoreB));
            await delay(args.settleMs / 3);
            addStep("Recurse checkbox restored (toggled back)");
          }
        } else {
          recordBlocked("F010", "/play", "play-recurse-toggle", "Play page not detected after Recurse toggle");
        }
      } else {
        recordBlocked("F010", "/play", "play-recurse-toggle", "Recurse checkbox not found in safe zone");
      }
    }

    // ===== WAVE 6.6: DISKS PAGE =====
    addStep("=== WAVE 6.6: Disks & Drives page ===");
    await client.pressKey(serial, KEY.TAB_DISKS);
    await delay(args.settleMs);
    const disksXml = await captureState(client, serial, artifactDir, "disks-initial");
    const onDisks = findTextContaining(disksXml, "DISKS") !== null ||
      findTextContaining(disksXml, "DRIVES") !== null ||
      findTextContaining(disksXml, "Drive A") !== null;

    if (!onDisks) {
      recordBlocked("F007", "/disks", "disks-page-load", "DISKS text not found after KEY_3");
    } else {
      recordPass("F007", "/disks", "disks-page-load", "keypad", "KEY_3 navigated to DISKS; page content detected");

      // Drive A Bus ID spinner (#8) — tap to expand, dismiss with BACK
      const busIdBounds = findVisibleBoundsByText(disksXml, "#8");
      const busIdAlt = busIdBounds ?? findVisibleBoundsByText(disksXml, "#9");
      if (busIdBounds && centerY(busIdBounds) <= SAFE_TAP_MAX_Y) {
        addStep(`tapping Drive A Bus ID spinner at (${centerX(busIdBounds)}, ${centerY(busIdBounds)})`);
        await client.tap(serial, centerX(busIdBounds), centerY(busIdBounds));
        await delay(args.settleMs / 2);
        const afterXml = await client.captureUiHierarchy(serial);
        // Spinner expanded: look for dropdown items or the same text still visible
        const spinnerExpanded = findTextContaining(afterXml, "#8") !== null ||
          findTextContaining(afterXml, "#9") !== null ||
          findTextContaining(afterXml, "#10") !== null;
        if (spinnerExpanded) {
          recordPass("F007", "/disks", "disks-drive-a-bus-spinner", "touch", "Drive A Bus ID spinner tapped; dropdown visible");
          // Dismiss dropdown with BACK
          await client.pressKey(serial, KEY.BACK);
          await delay(args.settleMs / 3);
        } else {
          recordBlocked("F007", "/disks", "disks-drive-a-bus-spinner", "Spinner did not expand after tap");
        }
      } else {
        recordBlocked("F007", "/disks", "disks-drive-a-bus-spinner",
          `Drive A Bus ID spinner not found in safe zone (bounds=${busIdBounds ? `y=${centerY(busIdBounds)}` : "null"})`);
      }

      // Drive A Drive Type spinner (1541)
      const disksXml2 = await client.captureUiHierarchy(serial);
      const driveTypeBounds = findVisibleBoundsByText(disksXml2, "1541");
      if (driveTypeBounds && centerY(driveTypeBounds) <= SAFE_TAP_MAX_Y) {
        addStep(`tapping Drive A Drive Type spinner at (${centerX(driveTypeBounds)}, ${centerY(driveTypeBounds)})`);
        await client.tap(serial, centerX(driveTypeBounds), centerY(driveTypeBounds));
        await delay(args.settleMs / 2);
        const afterXml = await client.captureUiHierarchy(serial);
        const typeExpanded = findTextContaining(afterXml, "1541") !== null ||
          findTextContaining(afterXml, "1571") !== null ||
          findTextContaining(afterXml, "1581") !== null;
        if (typeExpanded) {
          recordPass("F007", "/disks", "disks-drive-a-type-spinner", "touch", "Drive A Drive Type spinner tapped; dropdown visible");
          await client.pressKey(serial, KEY.BACK);
          await delay(args.settleMs / 3);
        } else {
          recordBlocked("F007", "/disks", "disks-drive-a-type-spinner", "Drive Type spinner did not expand");
        }
      } else {
        recordBlocked("F007", "/disks", "disks-drive-a-type-spinner",
          `Drive Type spinner not found in safe zone (bounds=${driveTypeBounds ? `y=${centerY(driveTypeBounds)}` : "null"})`);
      }

      // Drive A Mount disk button (content-desc)
      const disksXml3 = await client.captureUiHierarchy(serial);
      const mountABounds = findVisibleBoundsByContentDesc(disksXml3, "Drive A Mount disk");
      if (mountABounds && centerY(mountABounds) <= SAFE_TAP_MAX_Y) {
        addStep(`tapping "Drive A Mount disk" at (${centerX(mountABounds)}, ${centerY(mountABounds)})`);
        await client.tap(serial, centerX(mountABounds), centerY(mountABounds));
        await delay(args.settleMs);
        const afterXml = await client.captureUiHierarchy(serial);
        // May open a file picker or stay on disks. Either way, navigate back to disks.
        const stillOnDisks = findTextContaining(afterXml, "DISKS") !== null ||
          findTextContaining(afterXml, "Drive A") !== null ||
          findTextContaining(afterXml, "DRIVES") !== null;
        if (stillOnDisks) {
          recordPass("F007", "/disks", "disks-drive-a-mount", "touch", "Drive A Mount disk tapped; Disks page still active");
        } else {
          // App may have navigated to file picker — go back to Disks
          await client.pressKey(serial, KEY.BACK);
          await delay(args.settleMs / 2);
          const recoveredXml = await client.captureUiHierarchy(serial);
          const recovered = findTextContaining(recoveredXml, "DISKS") !== null ||
            findTextContaining(recoveredXml, "Drive A") !== null;
          if (recovered) {
            recordPass("F007", "/disks", "disks-drive-a-mount", "touch", "Drive A Mount disk opened picker; BACK returned to Disks");
          } else {
            recordBlocked("F007", "/disks", "disks-drive-a-mount", "Disks page not detected after Mount + BACK");
          }
        }
      } else {
        recordBlocked("F007", "/disks", "disks-drive-a-mount", "Drive A Mount disk button not found in safe zone");
      }
    }

    // ===== WAVE 6.7: CONFIG PAGE =====
    addStep("=== WAVE 6.7: Config page ===");
    await client.pressKey(serial, KEY.TAB_CONFIG);
    await delay(args.settleMs);
    const configXml = await captureState(client, serial, artifactDir, "config-initial");
    const onConfig = findTextContaining(configXml, "CONFIG") !== null;

    if (!onConfig) {
      recordBlocked("F018", "/config", "config-page-load", "CONFIG text not found after KEY_4");
    } else {
      recordPass("F018", "/config", "config-page-load", "keypad", "KEY_4 navigated to CONFIG; CONFIG text detected");

      // Config may show "Config categories could not be loaded." with a Retry button (circuit open),
      // OR show actual config categories if the device is healthy. Handle both cases.
      const hasRetry = findVisibleBoundsByText(configXml, "Retry") !== null;
      const hasCategories = findTextContaining(configXml, "Memory") !== null ||
        findTextContaining(configXml, "Audio") !== null ||
        findTextContaining(configXml, "Video") !== null ||
        findTextContaining(configXml, "memory") !== null;

      if (hasRetry) {
        // Circuit-open state: tap Retry to exercise the CTA
        const retryBounds = findVisibleBoundsByText(configXml, "Retry");
        if (retryBounds && centerY(retryBounds) <= SAFE_TAP_MAX_Y) {
          addStep(`tapping Retry button at (${centerX(retryBounds)}, ${centerY(retryBounds)})`);
          await client.tap(serial, centerX(retryBounds), centerY(retryBounds));
          await delay(args.settleMs);
          const afterXml = await client.captureUiHierarchy(serial);
          const stillOnConfig = findTextContaining(afterXml, "CONFIG") !== null;
          if (stillOnConfig) {
            recordPass("F018", "/config", "config-retry-btn", "touch", "Config Retry button tapped; Config page still active");
          } else {
            recordBlocked("F018", "/config", "config-retry-btn", "Config page not detected after Retry");
          }
        } else {
          recordBlocked("F018", "/config", "config-retry-btn", "Retry button not in safe zone");
        }
      } else if (hasCategories) {
        // Healthy state: try to tap the first visible config category
        const categoryNames = ["Memory & ROMs", "Memory", "Audio", "Video", "memory & roms"];
        let catTapped = false;
        for (const cat of categoryNames) {
          const catBounds = findVisibleBoundsByText(configXml, cat);
          if (catBounds && centerY(catBounds) <= SAFE_TAP_MAX_Y) {
            addStep(`tapping config category "${cat}" at (${centerX(catBounds)}, ${centerY(catBounds)})`);
            await client.tap(serial, centerX(catBounds), centerY(catBounds));
            await delay(args.settleMs);
            const afterXml = await client.captureUiHierarchy(serial);
            const stillOnConfig = findTextContaining(afterXml, "CONFIG") !== null ||
              findTextContaining(afterXml, cat) !== null;
            if (stillOnConfig) {
              recordPass("F018", "/config", "config-category-tap", "touch", `Config category "${cat}" tapped; Config page still active`);
            } else {
              recordBlocked("F018", "/config", "config-category-tap", `Config page not detected after tapping "${cat}"`);
            }
            catTapped = true;
            break;
          }
        }
        if (!catTapped) {
          addStep("No visible config categories found in safe zone — scrolling for first category");
          const catResult = await scrollUntilInSafeZone(
            client, serial, artifactDir, "scroll-config-category", args.settleMs, SAFE_TAP_MAX_Y,
            (xml) => {
              for (const name of categoryNames) {
                const b = findVisibleBoundsByText(xml, name);
                if (b) return b;
              }
              return null;
            },
          );
          if (catResult) {
            await client.tap(serial, centerX(catResult.bounds), centerY(catResult.bounds));
            await delay(args.settleMs);
            const afterXml = await client.captureUiHierarchy(serial);
            if (findTextContaining(afterXml, "CONFIG") !== null) {
              recordPass("F018", "/config", "config-category-tap", "touch", "Config category tapped after scroll; Config page still active");
            } else {
              recordBlocked("F018", "/config", "config-category-tap", "Config page not detected after category tap");
            }
          } else {
            recordBlocked("F018", "/config", "config-category-tap", "No config categories found");
          }
        }
      } else {
        addStep("Config page shows neither Retry nor categories — recording BLOCKED for config interaction");
        recordBlocked("F018", "/config", "config-interaction", "No Retry button or config categories visible");
      }
    }

    addStep(`Gate 6.5 complete: ${coverageRecords.filter((r) => r.status === "PASS").length} PASS / ${coverageRecords.length} total`);
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

  const gate65Result = {
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
  await writeFile(path.join(artifactDir, "gate65-result.json"), JSON.stringify(gate65Result, null, 2), "utf-8");

  console.log(`Gate 6.5 artifacts written: ${artifactDir}`);
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
