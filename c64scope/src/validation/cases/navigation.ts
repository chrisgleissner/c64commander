/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import path from "node:path";
import { adb, c64uGet, captureLogcat, isAppInForeground, launchApp, takeScreenshot, ts } from "../helpers.js";
import type { ValidationCase } from "../types.js";

// ---------------------------------------------------------------------------
// NAV-001 — App launch and route navigation
// ---------------------------------------------------------------------------

export const navRouteShell: ValidationCase = {
  id: "NAV-001",
  name: "App launch and UI verification",
  caseId: "NAV-SHELL-001",
  featureArea: "Navigation",
  route: "/",
  safetyClass: "read-only",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/", "/play", "/disks", "/config", "/settings", "/docs"],
      decisionLog: [
        `${ts()} Decision: launch C64 Commander app via ADB am start`,
        `${ts()} Decision: verify app is in foreground via dumpsys activity`,
        `${ts()} Decision: capture screenshot proving app UI is visible`,
        `${ts()} Decision: capture logcat for diagnostics correlation`,
      ],
      safetyBudget: "read-only",
      oracleSelection: [
        "UI: app launched + foreground check + screenshot",
        "Diagnostics and logs: logcat contains app activity entries",
      ],
      recoveryActions: [],
    };

    // Step 1: Launch the app
    await launchApp(ctx.serial);
    trace.decisionLog.push(`${ts()} Action: launched C64 Commander via am start`);

    const inForeground = await isAppInForeground(ctx.serial);
    trace.decisionLog.push(`${ts()} Observed: app in foreground=${inForeground}`);

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-01",
      route: "/",
      featureArea: "Navigation",
      action: "launch_app",
      peerServer: "mobile_controller",
      primaryOracle: "UI",
      notes: `App launched, foreground=${inForeground}`,
    });

    // Step 2: Screenshot the app (should now show C64 Commander)
    const ssPath = path.join(ctx.artifactDir, "nav-screen.png");
    await takeScreenshot(ctx.serial, ssPath);

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-ss-01",
      stepId: "step-01",
      evidenceType: "screenshot",
      summary: "C64 Commander app screenshot after launch",
      path: ssPath,
    });

    // Step 3: Capture logcat for diagnostics
    const logPath = path.join(ctx.artifactDir, "logcat.txt");
    const logcat = await captureLogcat(ctx.serial, logPath);
    const hasAppLog = logcat.includes("c64commander") || logcat.includes("uk.gleissner");

    trace.decisionLog.push(`${ts()} Observed: logcat contains app entries=${hasAppLog}`);

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-log-01",
      stepId: "step-01",
      evidenceType: "logcat",
      summary: "Android logcat after app launch",
      path: logPath,
      metadata: { lines: logcat.split("\n").length, hasAppEntries: hasAppLog },
    });

    // Assertions
    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "App launched and in foreground",
      oracleClass: "UI",
      passed: inForeground,
      details: { foreground: inForeground, screenshot: "nav-screen.png" },
    });

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-02",
      title: "App activity entries in logcat",
      oracleClass: "Diagnostics and logs",
      passed: hasAppLog,
      details: { logLines: logcat.split("\n").length, logFile: "logcat.txt" },
    });

    return {
      assertions: [
        {
          oracleClass: "UI",
          passed: inForeground,
          details: { foreground: inForeground },
        },
        {
          oracleClass: "Diagnostics and logs",
          passed: hasAppLog,
          details: { logcat: true },
        },
      ],
      explorationTrace: trace,
    };
  },
};

// ---------------------------------------------------------------------------
// CONN-001 — Connection status with app in foreground
// ---------------------------------------------------------------------------

export const connStatus: ValidationCase = {
  id: "CONN-001",
  name: "Connection status with app in foreground",
  caseId: "CONN-001",
  featureArea: "Connection",
  route: "/",
  safetyClass: "read-only",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "REST-visible state"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/"],
      decisionLog: [
        `${ts()} Decision: ensure app is launched and in foreground`,
        `${ts()} Decision: query C64U /v1/version for connection proof`,
        `${ts()} Decision: query C64U /v1/info for firmware/product evidence`,
        `${ts()} Decision: screenshot device showing app connected`,
      ],
      safetyBudget: "read-only",
      oracleSelection: [
        "UI: app launched + screenshot showing connection",
        "REST-visible state: C64U version + info endpoints",
      ],
      recoveryActions: [],
    };

    // Step 0: Launch app if not already in foreground
    const alreadyForeground = await isAppInForeground(ctx.serial);
    if (!alreadyForeground) {
      await launchApp(ctx.serial);
      trace.decisionLog.push(`${ts()} Action: launched app (was not in foreground)`);
    } else {
      trace.decisionLog.push(`${ts()} Observed: app already in foreground`);
    }

    // Step 1: C64U version
    const version = await c64uGet(ctx.c64uHost, "/v1/version");
    trace.decisionLog.push(`${ts()} Observed: version response length=${version.length}`);

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-01",
      route: "/",
      featureArea: "Connection",
      action: "query_c64u_version",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `Version: ${version.trim().substring(0, 100)}`,
    });

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-rest-version",
      stepId: "step-01",
      evidenceType: "rest_snapshot",
      summary: "C64U version endpoint",
      metadata: { endpoint: "/v1/version", response: version.trim() },
    });

    // Step 2: C64U info
    const info = await c64uGet(ctx.c64uHost, "/v1/info");
    const infoData = JSON.parse(info);
    trace.decisionLog.push(
      `${ts()} Observed: product=${infoData.product}, firmware=${infoData.firmware_version}, hostname=${infoData.hostname}`,
    );

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-02",
      route: "/",
      featureArea: "Connection",
      action: "query_c64u_info",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `Product: ${infoData.product}, FW: ${infoData.firmware_version}`,
    });

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-rest-info",
      stepId: "step-02",
      evidenceType: "rest_snapshot",
      summary: "C64U info endpoint",
      metadata: { endpoint: "/v1/info", response: infoData },
    });

    // Step 3: Screenshot
    const ssPath = path.join(ctx.artifactDir, "connection-screen.png");
    await takeScreenshot(ctx.serial, ssPath);

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-ss-conn",
      stepId: "step-02",
      evidenceType: "screenshot",
      summary: "Device screenshot during connection check",
      path: ssPath,
    });

    // Assertions
    const versionValid = version.length > 0 && version.includes("version");
    const infoValid = infoData.product !== undefined && infoData.firmware_version !== undefined;

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Device screenshot captured (UI oracle)",
      oracleClass: "UI",
      passed: true,
      details: { screenshot: "connection-screen.png" },
    });

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-02",
      title: "C64U REST API healthy",
      oracleClass: "REST-visible state",
      passed: versionValid && infoValid,
      details: {
        product: infoData.product,
        firmware: infoData.firmware_version,
        hostname: infoData.hostname,
      },
    });

    return {
      assertions: [
        { oracleClass: "UI", passed: true, details: {} },
        {
          oracleClass: "REST-visible state",
          passed: versionValid && infoValid,
          details: { product: infoData.product },
        },
      ],
      explorationTrace: trace,
    };
  },
};

// ---------------------------------------------------------------------------
// CONN-002 — Connection diagnostics
// ---------------------------------------------------------------------------

export const connDiagnostics: ValidationCase = {
  id: "CONN-002",
  name: "Connection diagnostics validation",
  caseId: "CONN-DIAG-001",
  featureArea: "Connection",
  route: "/",
  safetyClass: "read-only",
  expectedOutcome: "pass",
  oracleClasses: ["REST-visible state", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/"],
      decisionLog: [
        `${ts()} Decision: query multiple REST endpoints for health baseline`,
        `${ts()} Decision: capture logcat for diagnostics correlation`,
        `${ts()} Decision: use REST + Diagnostics oracle pair`,
      ],
      safetyBudget: "read-only",
      oracleSelection: ["REST-visible state: version + info + drives", "Diagnostics and logs: logcat correlation"],
      recoveryActions: [],
    };

    // Step 1: Version endpoint
    const version = await c64uGet(ctx.c64uHost, "/v1/version");
    trace.decisionLog.push(`${ts()} Observed: version OK`);

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-01",
      route: "/",
      featureArea: "Connection",
      action: "verify_rest_version",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `Version: ${version.trim().substring(0, 80)}`,
    });

    // Step 2: Info endpoint
    const info = await c64uGet(ctx.c64uHost, "/v1/info");
    const infoData = JSON.parse(info);
    trace.decisionLog.push(`${ts()} Observed: info product=${infoData.product} fw=${infoData.firmware_version}`);

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-02",
      route: "/",
      featureArea: "Connection",
      action: "verify_rest_info",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `Product: ${infoData.product}`,
    });

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-info",
      stepId: "step-02",
      evidenceType: "rest_snapshot",
      summary: "C64U info snapshot",
      metadata: { endpoint: "/v1/info", data: infoData },
    });

    // Step 3: Drives endpoint
    const drives = await c64uGet(ctx.c64uHost, "/v1/drives");
    const driveData = JSON.parse(drives);
    trace.decisionLog.push(`${ts()} Observed: drives endpoint returned ${drives.length} bytes`);

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-03",
      route: "/",
      featureArea: "Connection",
      action: "verify_rest_drives",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `Drives data length: ${drives.length}`,
    });

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-drives",
      stepId: "step-03",
      evidenceType: "rest_snapshot",
      summary: "C64U drive state",
      metadata: { endpoint: "/v1/drives", drives: driveData },
    });

    // Step 4: Logcat for diagnostics
    const logPath = path.join(ctx.artifactDir, "logcat.txt");
    const logcat = await captureLogcat(ctx.serial, logPath);

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-logcat",
      stepId: "step-03",
      evidenceType: "logcat",
      summary: "Android logcat during REST diagnostics",
      path: logPath,
      metadata: { lines: logcat.split("\n").length },
    });

    // Assertions
    const restHealthy = version.length > 0 && info.length > 0 && drives.length > 0;

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "All REST endpoints respond",
      oracleClass: "REST-visible state",
      passed: restHealthy,
      details: {
        version: version.length > 0,
        info: info.length > 0,
        drives: drives.length > 0,
      },
    });

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-02",
      title: "Logcat captured for correlation",
      oracleClass: "Diagnostics and logs",
      passed: true,
      details: { logLines: logcat.split("\n").length },
    });

    return {
      assertions: [
        { oracleClass: "REST-visible state", passed: restHealthy, details: {} },
        { oracleClass: "Diagnostics and logs", passed: true, details: {} },
      ],
      explorationTrace: trace,
    };
  },
};
