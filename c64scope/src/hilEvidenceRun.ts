/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile, spawn } from "node:child_process";
import { access, cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "./deviceRegistry.js";
import { runPreflight } from "./preflight.js";
import { ScopeSessionStore } from "./sessionStore.js";
import { adb, isAppInForeground, launchApp, takeScreenshot } from "./validation/helpers.js";

const APP_RECORDING_REMOTE_PATH = "/sdcard/Download/c64scope-app-session.mp4";

const execFileAsync = promisify(execFile);

interface StepDef {
  stepId: string;
  title: string;
  action: (serial: string) => Promise<void>;
}

interface ArtifactGate {
  ok: boolean;
  errors: string[];
  summary: {
    appStepScreenshots: number;
    c64StepScreenshots: number;
    appMp4Count: number;
    c64Mp4Count: number;
  };
}

interface AppRecorderHandle {
  stop: () => Promise<void>;
}

type BridgeAction = "streams.video.start" | "streams.video.stop" | "streams.audio.start" | "streams.audio.stop";

interface BridgeUsageEntry {
  action: BridgeAction;
  justification: string;
  allowedInProductRun: boolean;
  recordedAt: string;
}

function runIdPrefix(): string {
  return new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWorkspaceRoot(): string {
  return path.basename(process.cwd()) === "c64scope" ? path.resolve(process.cwd(), "..") : process.cwd();
}

async function runC64Capture(outputDir: string, durationMs: number, label: string): Promise<void> {
  const scriptPath = await resolveCaptureScriptPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "node",
      [scriptPath, "--output-dir", outputDir, "--duration-ms", String(durationMs), "--label", label],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`c64 capture render failed with exit code ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

async function resolveCaptureScriptPath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), ".tmp", "c64_capture_render.mjs"),
    path.resolve(process.cwd(), "..", ".tmp", "c64_capture_render.mjs"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(`Unable to locate c64 capture script. Checked: ${candidates.join(", ")}`);
}

async function setC64Stream(
  c64uHost: string,
  streamType: "video" | "audio",
  action: "start" | "stop",
  destinationIp?: string,
): Promise<void> {
  const bridgeAction = `streams.${streamType}.${action}` as BridgeAction;
  assertAllowedBridgeAction(bridgeAction);

  const endpoint =
    action === "start"
      ? `http://${c64uHost}/v1/streams/${streamType}:start?ip=${encodeURIComponent(
          destinationIp ?? (streamType === "video" ? "239.0.1.64:11000" : "239.0.1.65:11001"),
        )}`
      : `http://${c64uHost}/v1/streams/${streamType}:stop`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`C64 ${streamType} stream ${action} failed (${response.status}): ${body.slice(0, 200)}`);
  }
}

function assertAllowedBridgeAction(action: BridgeAction): void {
  const allowedProductActions = new Set<BridgeAction>([
    "streams.video.start",
    "streams.video.stop",
    "streams.audio.start",
    "streams.audio.stop",
  ]);

  if (!allowedProductActions.has(action)) {
    throw new Error(`Forbidden c64bridge action in product validation: ${action}`);
  }
}

async function startC64Streams(c64uHost: string, hostIpv4: string): Promise<void> {
  void hostIpv4;
  await setC64Stream(c64uHost, "video", "start", "239.0.1.64:11000");
  await setC64Stream(c64uHost, "audio", "start", "239.0.1.65:11001");
}

async function stopC64Streams(c64uHost: string): Promise<void> {
  await setC64Stream(c64uHost, "video", "stop");
  await setC64Stream(c64uHost, "audio", "stop");
}

async function runC64CaptureWithRetry(
  outputDir: string,
  durationMs: number,
  label: string,
  retries: number,
  onRetry?: (attempt: number, error: Error) => Promise<void>,
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await runC64Capture(outputDir, durationMs, label);
      return;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`C64 capture attempt ${attempt}/${retries} failed: ${lastError.message}`);
      if (onRetry && attempt < retries) {
        await onRetry(attempt, lastError);
      }
      if (attempt < retries) {
        await sleep(1200);
      }
    }
  }
  throw new Error(`C64 capture failed after ${retries} attempts: ${lastError?.message ?? "unknown error"}`);
}

async function gateArtifacts(artifactDir: string, expectedSteps: number): Promise<ArtifactGate> {
  const appDir = path.join(artifactDir, "screenshots", "app");
  const c64Dir = path.join(artifactDir, "screenshots", "c64");
  const recDir = path.join(artifactDir, "recordings");

  const [appFiles, c64Files, recFiles] = await Promise.all([
    readDirOrWarn(appDir),
    readDirOrWarn(c64Dir),
    readDirOrWarn(recDir),
  ]);

  const appStepScreenshots = appFiles.filter((name) => /^step-\d+-app\.png$/.test(name)).length;
  const c64StepScreenshots = c64Files.filter((name) => /^step-\d+-c64\.png$/.test(name)).length;
  const appMp4Count = recFiles.filter((name) => name === "app-session.mp4").length;
  const c64Mp4Count = recFiles.filter((name) => name === "run-full.mp4").length;

  const errors: string[] = [];
  if (appStepScreenshots < expectedSteps) {
    errors.push(`Expected ${expectedSteps} app step screenshots, found ${appStepScreenshots}`);
  }
  if (c64StepScreenshots < expectedSteps) {
    errors.push(`Expected ${expectedSteps} c64 step screenshots, found ${c64StepScreenshots}`);
  }
  if (appMp4Count < 1) {
    errors.push("Expected Android app MP4 recording app-session.mp4, found none");
  }
  if (c64Mp4Count < 1) {
    errors.push("Expected C64 MP4 recording run-full.mp4, found none");
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      appStepScreenshots,
      c64StepScreenshots,
      appMp4Count,
      c64Mp4Count,
    },
  };
}

async function startAppRecording(serial: string): Promise<AppRecorderHandle> {
  try {
    await adb(serial, "shell", "rm", "-f", APP_RECORDING_REMOTE_PATH);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Unable to remove stale app recording on device: ${message}`);
  }

  const recorderProcess = spawn(
    "adb",
    ["-s", serial, "shell", "screenrecord", "--bit-rate", "6000000", "--time-limit", "180", APP_RECORDING_REMOTE_PATH],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  recorderProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    stop: async () => {
      // SIGINT asks the local adb process to terminate screenrecord cleanly and flush the MP4.
      recorderProcess.kill("SIGINT");
      await new Promise<void>((resolve) => {
        recorderProcess.once("close", () => {
          resolve();
        });
      });

      if (stderr.trim().length > 0) {
        console.warn(`adb screenrecord stderr: ${stderr.slice(-500)}`);
      }
    },
  };
}

async function pullAppRecording(serial: string, localPath: string): Promise<void> {
  await execFileAsync("adb", ["-s", serial, "pull", APP_RECORDING_REMOTE_PATH, localPath]);
  await adb(serial, "shell", "rm", "-f", APP_RECORDING_REMOTE_PATH);
}

async function readDirOrWarn(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Unable to read directory ${directoryPath}: ${message}`);
    return [];
  }
}

async function main(): Promise<void> {
  const serialInput = process.env["ANDROID_SERIAL"];
  const serial = serialInput ? await resolveAdbSerial(serialInput) : await resolvePreferredPhysicalTestDeviceSerial();
  const c64uHost = process.env["C64U_HOST"] ?? "c64u";
  const workspaceRoot = resolveWorkspaceRoot();
  const artifactsRoot = path.resolve(workspaceRoot, "c64scope", "artifacts");

  const preflight = await runPreflight({ deviceSerial: serial, c64uHost });
  if (!preflight.ready) {
    const detail = preflight.checks.map((c) => `${c.name}=${c.status} (${c.detail})`).join("; ");
    throw new Error(`Preflight failed: ${detail}`);
  }

  const hostIpv4 = "multicast";
  const runLabel = `hil-${runIdPrefix()}`;
  const scenarioId = "scenario-001-app-first-evidence";
  const artifactDir = path.join(artifactsRoot, runLabel, scenarioId);
  const appScreensDir = path.join(artifactDir, "screenshots", "app");
  const c64ScreensDir = path.join(artifactDir, "screenshots", "c64");
  const recordingsDir = path.join(artifactDir, "recordings");
  const c64CaptureDir = path.join(artifactDir, "signal-analysis", "c64-stream");
  const bridgeUsagePath = path.join(artifactDir, "bridge-usage-justification.json");

  await mkdir(appScreensDir, { recursive: true });
  await mkdir(c64ScreensDir, { recursive: true });
  await mkdir(recordingsDir, { recursive: true });

  const store = new ScopeSessionStore(artifactsRoot);
  const started = await store.startSession({
    caseId: "HIL-APP-FIRST-001",
    artifactDir,
    captureEndpoints: ["udp://239.0.1.64:11000", "udp://239.0.1.65:11001"],
  });
  if (!started.ok) {
    throw new Error(`Failed to start c64scope session: ${started.error.message}`);
  }
  const runId = started.runId;

  await store.reserveCapture({ runId, endpoints: ["udp://239.0.1.64:11000", "udp://239.0.1.65:11001"] });
  await store.startCapture(runId);

  const steps: StepDef[] = [
    {
      stepId: "step-01",
      title: "launch-app",
      action: async (deviceSerial: string) => {
        await launchApp(deviceSerial);
      },
    },
    {
      stepId: "step-02",
      title: "home-and-relaunch",
      action: async (deviceSerial: string) => {
        await adb(deviceSerial, "shell", "input", "keyevent", "3");
        await sleep(800);
        await launchApp(deviceSerial);
      },
    },
    {
      stepId: "step-03",
      title: "foreground-check",
      action: async (deviceSerial: string) => {
        const inForeground = await isAppInForeground(deviceSerial);
        if (!inForeground) {
          throw new Error("App is not in foreground in step-03");
        }
      },
    },
  ];

  const bridgeUsage: BridgeUsageEntry[] = [
    {
      action: "streams.video.start",
      justification: "Start video multicast capture for evidence only after app-first control begins.",
      allowedInProductRun: true,
      recordedAt: new Date().toISOString(),
    },
    {
      action: "streams.audio.start",
      justification: "Start audio multicast capture for evidence only after app-first control begins.",
      allowedInProductRun: true,
      recordedAt: new Date().toISOString(),
    },
    {
      action: "streams.video.stop",
      justification: "Stop capture stream at run completion to avoid residual side effects.",
      allowedInProductRun: true,
      recordedAt: new Date().toISOString(),
    },
    {
      action: "streams.audio.stop",
      justification: "Stop capture stream at run completion to avoid residual side effects.",
      allowedInProductRun: true,
      recordedAt: new Date().toISOString(),
    },
  ];
  await writeFile(bridgeUsagePath, JSON.stringify(bridgeUsage, null, 2), "utf-8");

  await startC64Streams(c64uHost, hostIpv4);
  await sleep(2500);
  let c64CapturePromise: Promise<void> | null = null;
  let appRecorder: AppRecorderHandle | null = null;
  try {
    appRecorder = await startAppRecording(serial);

    c64CapturePromise = runC64CaptureWithRetry(c64CaptureDir, 22000, scenarioId, 2, async (attempt, error) => {
      console.warn(`Resetting C64 streams after capture retry ${attempt}: ${error.message}`);
      await stopC64Streams(c64uHost);
      await sleep(1200);
      await startC64Streams(c64uHost, hostIpv4);
      await sleep(2500);
    });

    for (const step of steps) {
      await store.recordStep({
        runId,
        stepId: step.stepId,
        route: "/",
        featureArea: "Play",
        action: step.title,
        peerServer: "mobile_controller",
        primaryOracle: "UI",
        fallbackOracle: "A/V signal",
        notes: "App-first step execution with required per-step screenshots",
      });

      await step.action(serial);

      const appShotName = `${step.stepId}-app.png`;
      const appShotPath = path.join(appScreensDir, appShotName);
      await takeScreenshot(serial, appShotPath);

      await store.attachEvidence({
        runId,
        evidenceId: `ev-${step.stepId}-app`,
        stepId: step.stepId,
        evidenceType: "screenshot",
        summary: `App screenshot for ${step.stepId}`,
        path: appShotPath,
      });

      await sleep(1200);
    }

    await c64CapturePromise;
  } finally {
    if (appRecorder) {
      try {
        await appRecorder.stop();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to stop app recording cleanly: ${message}`);
      }
    }

    try {
      await stopC64Streams(c64uHost);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to stop C64 streams cleanly: ${message}`);
    }
  }

  const c64GeneratedShotsDir = path.join(c64CaptureDir, "screenshots");
  const c64GeneratedRecDir = path.join(c64CaptureDir, "recordings");

  await cp(path.join(c64GeneratedShotsDir, "c64-start.png"), path.join(c64ScreensDir, "step-01-c64.png"));
  await cp(path.join(c64GeneratedShotsDir, "c64-mid.png"), path.join(c64ScreensDir, "step-02-c64.png"));
  await cp(path.join(c64GeneratedShotsDir, "c64-end.png"), path.join(c64ScreensDir, "step-03-c64.png"));
  await pullAppRecording(serial, path.join(recordingsDir, "app-session.mp4"));
  await cp(path.join(c64GeneratedRecDir, "c64-session.mp4"), path.join(recordingsDir, "run-full.mp4"));

  for (const step of steps) {
    await store.attachEvidence({
      runId,
      evidenceId: `ev-${step.stepId}-c64`,
      stepId: step.stepId,
      evidenceType: "stream_capture",
      summary: `C64 screenshot for ${step.stepId}`,
      path: path.join(c64ScreensDir, `${step.stepId}-c64.png`),
    });
  }

  await store.attachEvidence({
    runId,
    evidenceId: "ev-full-run-video",
    evidenceType: "stream_capture",
    summary: "Full-run C64 video capture",
    path: path.join(recordingsDir, "run-full.mp4"),
  });

  await store.attachEvidence({
    runId,
    evidenceId: "ev-full-run-app-video",
    evidenceType: "screen_recording",
    summary: "Full-run Android app screen recording",
    path: path.join(recordingsDir, "app-session.mp4"),
  });

  await store.attachEvidence({
    runId,
    evidenceId: "ev-bridge-usage-justification",
    evidenceType: "control_policy",
    summary: "Allowed c64bridge action justifications for product run",
    path: bridgeUsagePath,
    metadata: { bridgeActionCount: 4 },
  });

  const gate = await gateArtifacts(artifactDir, steps.length);
  await writeFile(path.join(artifactDir, "artifact-gate.json"), JSON.stringify(gate, null, 2), "utf-8");

  await store.recordAssertion({
    runId,
    assertionId: "assert-app-step-screenshots",
    title: "Per-step app screenshots present",
    oracleClass: "UI",
    passed: gate.summary.appStepScreenshots >= steps.length,
    details: gate.summary,
  });

  await store.recordAssertion({
    runId,
    assertionId: "assert-c64-step-screenshots",
    title: "Per-step C64 screenshots present",
    oracleClass: "A/V signal",
    passed: gate.summary.c64StepScreenshots >= steps.length,
    details: gate.summary,
  });

  await store.recordAssertion({
    runId,
    assertionId: "assert-full-run-video",
    title: "Full-run MP4 present",
    oracleClass: "A/V signal",
    passed: gate.summary.c64Mp4Count >= 1,
    details: gate.summary,
  });

  await store.recordAssertion({
    runId,
    assertionId: "assert-app-run-video",
    title: "Android app MP4 present",
    oracleClass: "UI",
    passed: gate.summary.appMp4Count >= 1,
    details: gate.summary,
  });

  const outcome = gate.ok ? "pass" : "fail";
  const failureClass = gate.ok ? "inconclusive" : "infrastructure_failure";
  const summary = gate.ok
    ? "Artifact gate satisfied: per-step app/c64 screenshots and full-run mp4 are present."
    : `Artifact gate failed: ${gate.errors.join("; ")}`;

  await store.stopCapture(runId);
  await store.finalizeSession({
    runId,
    outcome,
    failureClass,
    summary,
  });

  const latestLink = path.join(artifactsRoot, "latest-hil-evidence");
  await writeFile(
    path.join(artifactDir, "RESULT.txt"),
    `${outcome.toUpperCase()}\nrunId=${runId}\nartifactDir=${artifactDir}\n`,
    "utf-8",
  );

  // Keep a stable pointer to newest evidence run.
  await writeFile(latestLink, `${artifactDir}\n`, "utf-8");

  if (!gate.ok) {
    throw new Error(`Artifact gate failed: ${gate.errors.join("; ")}`);
  }

  console.log(JSON.stringify({ runId, artifactDir, gate }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exitCode = 1;
});
