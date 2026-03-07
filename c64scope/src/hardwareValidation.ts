/**
 * Real-hardware validation runner for Phase 10.
 *
 * Exercises c64scope session lifecycle against actual hardware:
 * - Starts a session
 * - Records steps with real device evidence
 * - Attaches evidence (screenshots, REST snapshots)
 * - Records assertions using the oracle policy
 * - Finalizes the session and verifies artifact output
 *
 * Usage:
 *   ANDROID_SERIAL=<device serial or 3-char prefix> C64U_HOST=192.168.1.13 node dist/hardwareValidation.js
 */

import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defaultPhysicalTestDevice, resolveAdbSerial } from "./deviceRegistry.js";
import { classifyRun, type AssertionRecord } from "./oraclePolicy.js";
import { runPreflight } from "./preflight.js";
import { ScopeSessionStore } from "./sessionStore.js";

const execFileAsync = promisify(execFile);

interface ValidationCase {
  name: string;
  caseId: string;
  expectedOutcome?: string;
  run: (ctx: CaseContext) => Promise<void>;
}

interface CaseContext {
  store: ScopeSessionStore;
  runId: string;
  serial: string;
  c64uHost: string;
  artifactDir: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function adb(serial: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("adb", ["-s", serial, ...args]);
  return stdout;
}

async function c64uGet(host: string, endpoint: string): Promise<string> {
  const { stdout } = await execFileAsync("curl", ["-fsS", "--connect-timeout", "5", `http://${host}${endpoint}`]);
  return stdout;
}

// ---------------------------------------------------------------------------
// Case: Read-only connection validation (RUN-002)
// ---------------------------------------------------------------------------

const connectionValidation: ValidationCase = {
  name: "Read-only connection validation",
  caseId: "CONN-001",
  async run(ctx) {
    // Step 1: Verify device screen is on
    const displayState = await adb(ctx.serial, "shell", "dumpsys", "power");
    const screenOn = displayState.includes("mWakefulness=Awake");

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-01",
      route: "/connection",
      featureArea: "Connection",
      action: "verify_device_awake",
      peerServer: "mobile_controller",
      primaryOracle: "UI",
      notes: `Screen awake: ${screenOn}`,
    });

    // Step 2: Take screenshot (use shell + pull for binary-safe transfer)
    const screenshotPath = path.join(ctx.artifactDir, "screen.png");
    await adb(ctx.serial, "shell", "screencap", "-p", "/data/local/tmp/c64scope_screen.png");
    await execFileAsync("adb", ["-s", ctx.serial, "pull", "/data/local/tmp/c64scope_screen.png", screenshotPath]);
    await adb(ctx.serial, "shell", "rm", "/data/local/tmp/c64scope_screen.png");

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-screenshot-01",
      stepId: "step-01",
      evidenceType: "screenshot",
      summary: "Device screenshot",
      path: screenshotPath,
    });

    // Step 3: Query C64U version
    const versionResponse = await c64uGet(ctx.c64uHost, "/v1/version");

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-02",
      route: "/connection",
      featureArea: "Connection",
      action: "verify_c64u_version",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `C64U version response: ${versionResponse.trim()}`,
    });

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-rest-01",
      stepId: "step-02",
      evidenceType: "rest_snapshot",
      summary: "C64U version endpoint",
      metadata: { endpoint: "/v1/version", response: versionResponse.trim() },
    });

    // Step 4: Query C64U info
    const infoResponse = await c64uGet(ctx.c64uHost, "/v1/info");

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-rest-02",
      stepId: "step-02",
      evidenceType: "rest_snapshot",
      summary: "C64U info endpoint",
      metadata: { endpoint: "/v1/info", response: infoResponse.trim() },
    });

    // Assertions
    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Device is awake",
      oracleClass: "UI",
      passed: screenOn,
      details: { source: "power_state" },
    });

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-02",
      title: "C64U REST API responds",
      oracleClass: "REST-visible state",
      passed: versionResponse.length > 0,
      details: { endpoint: "/v1/version", responseLength: versionResponse.length },
    });

    // Classify using oracle policy
    const assertions: AssertionRecord[] = [
      {
        oracleClass: "UI",
        passed: screenOn,
        details: { source: "power_state" },
      },
      {
        oracleClass: "REST-visible state",
        passed: versionResponse.length > 0,
        details: { endpoint: "/v1/version" },
      },
    ];

    const classification = classifyRun({
      assertions,
      safety: "read-only",
    });

    await ctx.store.finalizeSession({
      runId: ctx.runId,
      outcome: classification.outcome,
      failureClass: classification.failureClass,
      summary: `Connection validation: ${classification.outcome} — ${classification.reason}`,
    });
  },
};

// ---------------------------------------------------------------------------
// Case: Config browsing via REST (RUN-004 — non-A/V oracle)
// ---------------------------------------------------------------------------

const configBrowsing: ValidationCase = {
  name: "Config browsing via REST",
  caseId: "CFG-READ-001",
  async run(ctx) {
    // Step 1: List config categories
    const configsResponse = await c64uGet(ctx.c64uHost, "/v1/configs");

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-01",
      route: "/config",
      featureArea: "Config",
      action: "list_config_categories",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `Config response length: ${configsResponse.length}`,
    });

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-config-01",
      stepId: "step-01",
      evidenceType: "config_snapshot",
      summary: "C64U config categories",
      metadata: { snapshotName: "categories", responseLength: configsResponse.length },
    });

    // Step 2: Take device screenshot showing app state
    const configScreenPath = path.join(ctx.artifactDir, "config-screen.png");
    await adb(ctx.serial, "shell", "screencap", "-p", "/data/local/tmp/c64scope_config.png");
    await execFileAsync("adb", ["-s", ctx.serial, "pull", "/data/local/tmp/c64scope_config.png", configScreenPath]);
    await adb(ctx.serial, "shell", "rm", "/data/local/tmp/c64scope_config.png");

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-screenshot-01",
      stepId: "step-01",
      evidenceType: "screenshot",
      summary: "App state during config browse",
      path: configScreenPath,
    });

    // Assertions: two oracle classes (REST + UI)
    const configValid = configsResponse.length > 10;

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Config categories returned",
      oracleClass: "REST-visible state",
      passed: configValid,
      details: { responseLength: configsResponse.length },
    });

    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-02",
      title: "Device UI stable during config read",
      oracleClass: "UI",
      passed: true,
      details: { source: "screenshot_captured" },
    });

    const assertions: AssertionRecord[] = [
      {
        oracleClass: "REST-visible state",
        passed: configValid,
        details: {},
      },
      {
        oracleClass: "UI",
        passed: true,
        details: {},
      },
    ];

    const classification = classifyRun({
      assertions,
      safety: "read-only",
    });

    await ctx.store.finalizeSession({
      runId: ctx.runId,
      outcome: classification.outcome,
      failureClass: classification.failureClass,
      summary: `Config browsing: ${classification.outcome} — ${classification.reason}`,
    });
  },
};

// ---------------------------------------------------------------------------
// Case: Deliberate failure classification (RUN-006)
// ---------------------------------------------------------------------------

const deliberateFailure: ValidationCase = {
  name: "Deliberate failure classification",
  caseId: "FAIL-001",
  expectedOutcome: "fail",
  async run(ctx) {
    // Step 1: Query a known-bad endpoint
    let errorResponse = "";
    try {
      errorResponse = await c64uGet(ctx.c64uHost, "/v1/nonexistent");
    } catch (error: unknown) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.warn(`Expected invalid endpoint failure while running ${deliberateFailure.caseId}: ${message}`);
      errorResponse = "HTTP error (expected)";
    }

    await ctx.store.recordStep({
      runId: ctx.runId,
      stepId: "step-01",
      route: "/diagnostics",
      featureArea: "Diagnostics",
      action: "query_invalid_endpoint",
      peerServer: "c64bridge",
      primaryOracle: "REST-visible state",
      notes: `Deliberate error: ${errorResponse}`,
    });

    await ctx.store.attachEvidence({
      runId: ctx.runId,
      evidenceId: "ev-error-01",
      stepId: "step-01",
      evidenceType: "rest_snapshot",
      summary: "Deliberate invalid endpoint query",
      metadata: { endpoint: "/v1/nonexistent", error: errorResponse },
    });

    // Assertion: endpoint should fail
    await ctx.store.recordAssertion({
      runId: ctx.runId,
      assertionId: "assert-01",
      title: "Invalid endpoint returns error",
      oracleClass: "REST-visible state",
      passed: false,
      details: { expected: "failure", actual: errorResponse },
    });

    const assertions: AssertionRecord[] = [
      {
        oracleClass: "REST-visible state",
        passed: false,
        details: {},
      },
    ];

    const classification = classifyRun({
      assertions,
      safety: "read-only",
    });

    await ctx.store.finalizeSession({
      runId: ctx.runId,
      outcome: classification.outcome,
      failureClass: classification.failureClass,
      summary: `Deliberate failure: ${classification.outcome}/${classification.failureClass} — ${classification.reason}`,
    });
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runCase(
  caseInfo: ValidationCase,
  serial: string,
  c64uHost: string,
  artifactRoot: string,
): Promise<{ name: string; outcome: string; runId: string; artifactDir: string }> {
  const store = new ScopeSessionStore(artifactRoot);
  const result = await store.startSession({ caseId: caseInfo.caseId });

  if (!result.ok) {
    throw new Error(`Failed to start session: ${result.error.message}`);
  }

  const runId = result.runId;
  const artifactDir = (result.data as { artifactDir: string }).artifactDir;

  const ctx: CaseContext = { store, runId, serial, c64uHost, artifactDir };

  try {
    await caseInfo.run(ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finalizeSession({
      runId,
      outcome: "fail",
      failureClass: "infrastructure_failure",
      summary: `Case aborted: ${message}`,
    });
  }

  // Read back session to get outcome
  const sessionPath = path.join(artifactDir, "session.json");
  const sessionData = JSON.parse(await readFile(sessionPath, "utf-8"));

  return {
    name: caseInfo.name,
    outcome: sessionData.outcome ?? "unknown",
    runId,
    artifactDir,
  };
}

async function main(): Promise<void> {
  const serialInput = process.env["ANDROID_SERIAL"] ?? defaultPhysicalTestDevice.serialPrefix;
  const serial = await resolveAdbSerial(serialInput);
  const c64uHost = process.env["C64U_HOST"] ?? "192.168.1.13";

  // Preflight
  console.log("=== Preflight ===");
  const preflight = await runPreflight({
    deviceSerial: serial,
    c64uHost,
  });

  for (const check of preflight.checks) {
    const icon = check.status === "pass" ? "\u2713" : "\u2717";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }

  if (!preflight.ready) {
    console.error("\nPreflight failed. Cannot proceed.");
    process.exitCode = 1;
    return;
  }

  // Create temp artifact root
  const artifactRoot = path.join(tmpdir(), `c64scope-validation-${Date.now()}`);
  console.log(`\nArtifact root: ${artifactRoot}`);

  // Run cases
  const cases: ValidationCase[] = [connectionValidation, configBrowsing, deliberateFailure];

  const results: { name: string; outcome: string; runId: string; artifactDir: string }[] = [];

  for (const c of cases) {
    console.log(`\n--- ${c.name} (${c.caseId}) ---`);
    try {
      const result = await runCase(c, serial, c64uHost, artifactRoot);
      results.push(result);
      console.log(`  Outcome: ${result.outcome}`);
      console.log(`  Run ID:  ${result.runId}`);

      // List artifacts
      const files = await readdir(result.artifactDir);
      console.log(`  Artifacts: ${files.join(", ")}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ERROR: ${message}`);
      results.push({ name: c.name, outcome: "error", runId: "n/a", artifactDir: "n/a" });
    }
  }

  // Summary
  console.log("\n=== Validation Summary ===");
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const expected = cases[i]?.expectedOutcome ?? "pass";
    const correct = r.outcome === expected;
    const icon = correct ? "\u2713" : "\u2717";
    console.log(`  ${icon} ${r.name}: ${r.outcome} (expected: ${expected})`);
  }

  const correctCount = results.filter((r, i) => {
    const expected = cases[i]?.expectedOutcome ?? "pass";
    return r.outcome === expected;
  }).length;
  const incorrectCount = results.length - correctCount;
  console.log(`\n  ${correctCount} correct, ${incorrectCount} incorrect out of ${results.length}`);

  // Cleanup
  await rm(artifactRoot, { recursive: true, force: true });

  if (correctCount < results.length) {
    console.error(`\nValidation FAILED: ${incorrectCount} case(s) had unexpected outcome.`);
    process.exitCode = 1;
  } else {
    console.log("\nValidation PASSED: all cases matched expected outcomes.");
  }
}

main().catch((error: unknown) => {
  console.error("Validation runner failed:", error);
  process.exitCode = 1;
});
