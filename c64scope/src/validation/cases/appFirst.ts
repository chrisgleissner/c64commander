/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import path from "node:path";
import { dumpUiHierarchy, ts } from "../helpers.js";
import { parseUiNodes } from "../appFirstUi.js";
import { DroidmindClient } from "../droidmindClient.js";
import { ensureDeviceUnlocked, launchAppForeground, navigateToRoute, restartApp } from "../appFirstPrimitives.js";
import { appFirstPlaybackContinuity, appFirstPlaylistAutoAdvance } from "./exploratoryPlayback.js";
import type { ValidationCase } from "../types.js";

function hasMarker(nodes: ReturnType<typeof parseUiNodes>, marker: string): boolean {
  const normalized = marker.trim().toLowerCase();
  return nodes.some((node) => node.text.trim().toLowerCase().includes(normalized));
}

async function runSurfaceMarkerCase(
  ctx: Parameters<ValidationCase["run"]>[0],
  options: {
    route: string;
    featureArea: string;
    screenshotName: string;
    markers: readonly string[];
    stepId: string;
    action: string;
  },
): Promise<{ passed: boolean; missingMarkers: string[]; screenshotPath: string }> {
  const droidmind = new DroidmindClient();
  const screenshotPath = path.join(ctx.artifactDir, options.screenshotName);

  try {
    await droidmind.connect();
    await launchAppForeground(droidmind, ctx.serial);
    await navigateToRoute(droidmind, ctx.serial, options.route);

    const xml = await dumpUiHierarchy(ctx.serial);
    const nodes = parseUiNodes(xml);
    const missingMarkers = options.markers.filter((marker) => !hasMarker(nodes, marker));
    const passed = missingMarkers.length === 0;

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: options.stepId,
      route: options.route,
      featureArea: options.featureArea,
      action: options.action,
      peerServer: "mobile_controller",
      primaryOracle: "UI",
      notes: passed
        ? `Markers verified: ${options.markers.join(", ")}`
        : `Missing markers: ${missingMarkers.join(", ")}`,
    });

    await droidmind.screenshotToFile(ctx.serial, screenshotPath);
    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: `ev-${options.stepId}`,
      stepId: options.stepId,
      evidenceType: "screenshot",
      summary: `${options.featureArea} surface screenshot`,
      path: screenshotPath,
      metadata: {
        expectedMarkers: [...options.markers],
        missingMarkers,
      },
    });

    return { passed, missingMarkers, screenshotPath };
  } finally {
    await droidmind.close();
  }
}

export const appFirstLaunchShell: ValidationCase = {
  id: "AF-001",
  name: "App-first launch and home shell validation",
  caseId: "AF-LAUNCH-SHELL-001",
  featureArea: "Shell",
  route: "/",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/"],
      decisionLog: [
        `${ts()} Decision: connect droidmind MCP client`,
        `${ts()} Decision: launch app and verify home route markers`,
        `${ts()} Decision: capture app screenshot as UI evidence`,
      ],
      safetyBudget: "read-only",
      oracleSelection: ["UI: route markers + screenshot", "Diagnostics and logs: droidmind command traces"],
      recoveryActions: [] as string[],
    };

    const droidmind = new DroidmindClient();
    const screenshotPath = path.join(ctx.artifactDir, "af-home-shell.png");

    try {
      await droidmind.connect();
      const devices = await droidmind.listDevices();
      trace.decisionLog.push(`${ts()} Observed: droidmind device list output length=${devices.length}`);

      await launchAppForeground(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/");

      await ctx.store.recordStep({
        runId: ctx.runId,
        stepId: "step-01",
        route: "/",
        featureArea: "Shell",
        action: "launch_and_verify_home_route",
        peerServer: "mobile_controller",
        primaryOracle: "UI",
        notes: "App launched through droidmind and home markers verified.",
      });

      await droidmind.screenshotToFile(ctx.serial, screenshotPath);
      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-home-shell",
        stepId: "step-01",
        evidenceType: "screenshot",
        summary: "App-first home shell screenshot",
        path: screenshotPath,
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-01",
        title: "Home shell route is reachable app-first",
        oracleClass: "UI",
        passed: true,
        details: { screenshot: "af-home-shell.png" },
      });

      return {
        assertions: [{ oracleClass: "UI", passed: true, details: { route: "/" } }],
        explorationTrace: trace,
      };
    } finally {
      await droidmind.close();
    }
  },
};

export const appFirstTabNavigation: ValidationCase = {
  id: "AF-002",
  name: "App-first tab navigation across all primary routes",
  caseId: "AF-TABS-001",
  featureArea: "Navigation",
  route: "/",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const routes: readonly string[] = ["/", "/play", "/disks", "/config", "/settings", "/docs"];
    const trace = {
      routeDiscovery: [...routes],
      decisionLog: [
        `${ts()} Decision: launch app via droidmind`,
        `${ts()} Decision: traverse all tab routes and verify route markers`,
        `${ts()} Decision: capture screenshot evidence per route`,
      ],
      safetyBudget: "read-only",
      oracleSelection: ["UI: route markers on each tab", "Diagnostics and logs: per-route step traces"],
      recoveryActions: [] as string[],
    };

    const droidmind = new DroidmindClient();
    let allRoutesVisited = true;

    try {
      await droidmind.connect();
      await launchAppForeground(droidmind, ctx.serial);

      let stepNumber = 1;
      for (const route of routes) {
        const stepId = `step-${String(stepNumber).padStart(2, "0")}`;
        const screenshotName = `af-route-${stepNumber}.png`;
        const screenshotPath = path.join(ctx.artifactDir, screenshotName);
        stepNumber += 1;

        try {
          await navigateToRoute(droidmind, ctx.serial, route);
          trace.decisionLog.push(`${ts()} Observed: route '${route}' marker check passed`);

          await ctx.store.recordStep({
            runId: ctx.runId,
            stepId,
            route,
            featureArea: "Navigation",
            action: "navigate_route_tab",
            peerServer: "mobile_controller",
            primaryOracle: "UI",
            notes: `Route markers verified for ${route}.`,
          });

          await droidmind.screenshotToFile(ctx.serial, screenshotPath);
          await ctx.store.attachEvidence({
            runId: ctx.runId,
            evidenceId: `ev-route-${stepNumber - 1}`,
            stepId,
            evidenceType: "screenshot",
            summary: `App-first route screenshot (${route})`,
            path: screenshotPath,
          });
        } catch (error: unknown) {
          allRoutesVisited = false;
          const message = error instanceof Error ? error.message : String(error);
          trace.decisionLog.push(`${ts()} Failure: route '${route}' marker check failed: ${message}`);
          await ctx.store.recordStep({
            runId: ctx.runId,
            stepId,
            route,
            featureArea: "Navigation",
            action: "navigate_route_tab",
            peerServer: "mobile_controller",
            primaryOracle: "UI",
            notes: `Failed to verify route markers for ${route}: ${message}`,
          });
        }
      }

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-01",
        title: "Primary tab routes are reachable via app-first navigation",
        oracleClass: "UI",
        passed: allRoutesVisited,
        details: { routes },
      });

      return {
        assertions: [{ oracleClass: "UI", passed: allRoutesVisited, details: { routes } }],
        explorationTrace: trace,
      };
    } finally {
      await droidmind.close();
    }
  },
};

export const appFirstRuntimeRecovery: ValidationCase = {
  id: "AF-003",
  name: "App-first lock/unlock and restart recovery primitives",
  caseId: "AF-RUNTIME-RECOVERY-001",
  featureArea: "Runtime",
  route: "/",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/", "/play", "/"],
      decisionLog: [
        `${ts()} Decision: launch and navigate to play route`,
        `${ts()} Decision: lock screen then restore unlocked state`,
        `${ts()} Decision: restart app and verify home route after restart`,
      ],
      safetyBudget: "read-only",
      oracleSelection: ["UI: route markers before/after lock + restart", "Diagnostics and logs: runtime action trace"],
      recoveryActions: [] as string[],
    };

    const droidmind = new DroidmindClient();
    let recoverySucceeded = false;
    const screenshotPath = path.join(ctx.artifactDir, "af-runtime-recovery.png");

    try {
      await droidmind.connect();
      await launchAppForeground(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/play");

      // KEYCODE_POWER toggles screen state; then unlock routine restores app control.
      await droidmind.pressKey(ctx.serial, 26);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await droidmind.pressKey(ctx.serial, 26);
      await ensureDeviceUnlocked(droidmind, ctx.serial);

      await restartApp(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/");
      await droidmind.screenshotToFile(ctx.serial, screenshotPath);

      await ctx.store.recordStep({
        runId: ctx.runId,
        stepId: "step-01",
        route: "/play",
        featureArea: "Runtime",
        action: "lock_unlock_restart_recover",
        peerServer: "mobile_controller",
        primaryOracle: "UI",
        notes: "Lock/unlock and app restart sequence completed with route verification.",
      });

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-runtime-recovery",
        stepId: "step-01",
        evidenceType: "screenshot",
        summary: "Post-recovery screenshot on home route",
        path: screenshotPath,
      });

      recoverySucceeded = true;
      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-01",
        title: "Lock/unlock and restart recovery path returns to app control",
        oracleClass: "UI",
        passed: true,
        details: { screenshot: "af-runtime-recovery.png" },
      });

      return {
        assertions: [{ oracleClass: "UI", passed: true, details: {} }],
        explorationTrace: trace,
      };
    } finally {
      if (!recoverySucceeded) {
        trace.recoveryActions.push(`${ts()} Recovery: runtime recovery case did not complete successfully.`);
      }
      await droidmind.close();
    }
  },
};

export const appFirstHomeSurface: ValidationCase = {
  id: "AF-004",
  name: "App-first home feature surface markers",
  caseId: "AF-HOME-SURFACE-001",
  featureArea: "Home",
  route: "/",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/"],
      decisionLog: [`${ts()} Decision: validate home controls and quick-config marker visibility`],
      safetyBudget: "read-only",
      oracleSelection: ["UI: home marker visibility"],
      recoveryActions: [] as string[],
    };

    const result = await runSurfaceMarkerCase(ctx, {
      route: "/",
      featureArea: "Home",
      screenshotName: "af-home-surface.png",
      markers: ["HOME", "MACHINE", "Reset", "Reboot", "Save RAM", "QUICK CONFIG"],
      stepId: "step-01",
      action: "validate_home_surface_markers",
    });
    trace.decisionLog.push(
      `${ts()} Observed: home markers ${result.passed ? "present" : `missing=${result.missingMarkers.join(", ")}`}`,
    );

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Home feature markers are visible",
      oracleClass: "UI",
      passed: result.passed,
      details: { missingMarkers: result.missingMarkers },
    });

    return {
      assertions: [{ oracleClass: "UI", passed: result.passed, details: { missingMarkers: result.missingMarkers } }],
      explorationTrace: trace,
    };
  },
};

export const appFirstDisksSurface: ValidationCase = {
  id: "AF-005",
  name: "App-first disks feature surface markers",
  caseId: "AF-DISKS-SURFACE-001",
  featureArea: "Disks",
  route: "/disks",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/disks"],
      decisionLog: [`${ts()} Decision: validate disk and drive control marker visibility`],
      safetyBudget: "read-only",
      oracleSelection: ["UI: disks marker visibility"],
      recoveryActions: [] as string[],
    };

    const result = await runSurfaceMarkerCase(ctx, {
      route: "/disks",
      featureArea: "Disks",
      screenshotName: "af-disks-surface.png",
      markers: ["DISKS", "DRIVES", "Drive A", "Drive B", "Soft IEC Drive"],
      stepId: "step-01",
      action: "validate_disks_surface_markers",
    });
    trace.decisionLog.push(
      `${ts()} Observed: disks markers ${result.passed ? "present" : `missing=${result.missingMarkers.join(", ")}`}`,
    );

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Disks feature markers are visible",
      oracleClass: "UI",
      passed: result.passed,
      details: { missingMarkers: result.missingMarkers },
    });

    return {
      assertions: [{ oracleClass: "UI", passed: result.passed, details: { missingMarkers: result.missingMarkers } }],
      explorationTrace: trace,
    };
  },
};

export const appFirstPlaySurface: ValidationCase = {
  id: "AF-006",
  name: "App-first play feature surface markers",
  caseId: "AF-PLAY-SURFACE-001",
  featureArea: "Play",
  route: "/play",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/play"],
      decisionLog: [`${ts()} Decision: validate play, playlist, and transport marker visibility`],
      safetyBudget: "read-only",
      oracleSelection: ["UI: play marker visibility"],
      recoveryActions: [] as string[],
    };

    const result = await runSurfaceMarkerCase(ctx, {
      route: "/play",
      featureArea: "Play",
      screenshotName: "af-play-surface.png",
      markers: [
        "PLAY FILES",
        "Add items to playlist",
        "Playlist",
        "Previous",
        "Play",
        "Pause",
        "Next",
        "Default duration",
        "Songlengths file",
      ],
      stepId: "step-01",
      action: "validate_play_surface_markers",
    });
    trace.decisionLog.push(
      `${ts()} Observed: play markers ${result.passed ? "present" : `missing=${result.missingMarkers.join(", ")}`}`,
    );

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Play feature markers are visible",
      oracleClass: "UI",
      passed: result.passed,
      details: { missingMarkers: result.missingMarkers },
    });

    return {
      assertions: [{ oracleClass: "UI", passed: result.passed, details: { missingMarkers: result.missingMarkers } }],
      explorationTrace: trace,
    };
  },
};

export const appFirstConfigSurface: ValidationCase = {
  id: "AF-007",
  name: "App-first config feature surface markers",
  caseId: "AF-CONFIG-SURFACE-001",
  featureArea: "Config",
  route: "/config",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/config"],
      decisionLog: [`${ts()} Decision: validate config category and edit-surface markers`],
      safetyBudget: "read-only",
      oracleSelection: ["UI: config marker visibility"],
      recoveryActions: [] as string[],
    };

    const result = await runSurfaceMarkerCase(ctx, {
      route: "/config",
      featureArea: "Config",
      screenshotName: "af-config-surface.png",
      markers: ["CONFIG", "categories", "Audio Mixer", "Network Settings", "Drive A Settings"],
      stepId: "step-01",
      action: "validate_config_surface_markers",
    });
    trace.decisionLog.push(
      `${ts()} Observed: config markers ${result.passed ? "present" : `missing=${result.missingMarkers.join(", ")}`}`,
    );

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Config feature markers are visible",
      oracleClass: "UI",
      passed: result.passed,
      details: { missingMarkers: result.missingMarkers },
    });

    return {
      assertions: [{ oracleClass: "UI", passed: result.passed, details: { missingMarkers: result.missingMarkers } }],
      explorationTrace: trace,
    };
  },
};

export const appFirstSettingsSurface: ValidationCase = {
  id: "AF-008",
  name: "App-first settings feature surface markers",
  caseId: "AF-SETTINGS-SURFACE-001",
  featureArea: "Settings",
  route: "/settings",
  safetyClass: "read-only",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/settings"],
      decisionLog: [`${ts()} Decision: validate settings and diagnostics marker visibility`],
      safetyBudget: "read-only",
      oracleSelection: ["UI: settings marker visibility"],
      recoveryActions: [] as string[],
    };

    const result = await runSurfaceMarkerCase(ctx, {
      route: "/settings",
      featureArea: "Settings",
      screenshotName: "af-settings-surface.png",
      markers: [
        "SETTINGS",
        "Connection",
        "Save & Connect",
        "Diagnostics",
        "Export settings",
        "Import settings",
        "List preview limit",
      ],
      stepId: "step-01",
      action: "validate_settings_surface_markers",
    });
    trace.decisionLog.push(
      `${ts()} Observed: settings markers ${result.passed ? "present" : `missing=${result.missingMarkers.join(", ")}`}`,
    );

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Settings feature markers are visible",
      oracleClass: "UI",
      passed: result.passed,
      details: { missingMarkers: result.missingMarkers },
    });

    return {
      assertions: [{ oracleClass: "UI", passed: result.passed, details: { missingMarkers: result.missingMarkers } }],
      explorationTrace: trace,
    };
  },
};

export { appFirstPlaybackContinuity, appFirstPlaylistAutoAdvance };
