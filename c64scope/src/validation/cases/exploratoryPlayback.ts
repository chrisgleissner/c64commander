/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  captureAndAnalyzeStream,
  type AudioFeatures,
  findFirstSustainedAudioState,
  hasContinuousAudioState,
  medianEnvelopeRms,
} from "../../stream/index.js";
import { discoverDeviceMirror } from "../../testDataDiscovery.js";
import { DroidmindClient } from "../droidmindClient.js";
import { findVisibleText, parseUiNodes } from "../appFirstUi.js";
import {
  ensureDeviceUnlocked,
  launchAppForeground,
  navigateToRoute,
  tapByResourceId,
  tapByResourceIdOrLabel,
  tapByText,
} from "../appFirstPrimitives.js";
import {
  chooseSource,
  confirmAddItems,
  openAddItemsDialog,
  openPathSegments,
  readTopmostTrackLabel,
  setDurationSeconds,
  tapCheckboxForText,
  waitForTrackLabel,
} from "../appFirstPlaybackPrimitives.js";
import { captureLogcat, dumpUiHierarchy, ts } from "../helpers.js";
import type { ValidationCase } from "../types.js";

const AUDIO_RMS_THRESHOLD = 0.005;
const SILENCE_CONFIRM_MS = 180;
const ACTIVE_CONFIRM_MS = 180;
const LATENCY_BUDGET_MS = 300;
const STABILITY_WINDOW_MS = 6000;
const CAPTURE_PRE_ROLL_MS = 1200;
const MUTE_CAPTURE_DURATION_MS = 9000;
const UNMUTE_CAPTURE_DURATION_MS = 8500;
const C64U_SOURCE_LABELS = ["C64U", "C64 Ultimate", "Commodore 64 Ultimate"] as const;

type PlaybackTargets = {
  sourceSegments: string[];
  sidCandidates: [string, string];
  sidPath: string;
};

async function discoverPlaybackTargets(c64uHost: string): Promise<PlaybackTargets> {
  const discovery = await discoverDeviceMirror(c64uHost);
  if (discovery.sidCandidates.length < 2) {
    throw new Error(
      `Expected at least 2 SID candidates under ${discovery.sidPath}, found ${discovery.sidCandidates.length}.`,
    );
  }

  const sourceSegments = discovery.sidPath.split("/").filter((segment) => segment.length > 0);
  const [first, second] = discovery.sidCandidates;
  return {
    sourceSegments,
    sidCandidates: [first!, second!],
    sidPath: discovery.sidPath,
  };
}

async function addSidPlaylist(client: DroidmindClient, serial: string, targets: PlaybackTargets): Promise<void> {
  await openAddItemsDialog(client, serial);
  await chooseSource(client, serial, C64U_SOURCE_LABELS);
  await openPathSegments(client, serial, targets.sourceSegments);
  await tapCheckboxForText(client, serial, targets.sidCandidates[0]);
  await tapCheckboxForText(client, serial, targets.sidCandidates[1]);
  await confirmAddItems(client, serial);
}

async function capturePlaybackLogcat(
  serial: string,
  artifactDir: string,
  fileName: string,
): Promise<{ path: string; text: string }> {
  const logPath = path.join(artifactDir, fileName);
  const text = await captureLogcat(serial, logPath, 400);
  return { path: logPath, text };
}

async function captureAudioEvidence(c64uHost: string, artifactDir: string, suffix: string) {
  const captureDir = path.join(artifactDir, suffix);
  await writeFile(path.join(artifactDir, `${suffix}-placeholder.txt`), "capture-started\n", "utf-8");
  return captureAndAnalyzeStream({
    streamType: "audio",
    c64uHost,
    artifactDir: captureDir,
    durationMs: 2500,
  });
}

async function maybeClearPlaylist(client: DroidmindClient, serial: string): Promise<void> {
  const cleared = await tapByText(client, serial, "Clear playlist");
  if (cleared) {
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

async function waitForVisibleText(
  serial: string,
  expectedText: string,
  retries: number,
  delayMs: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const xml = await dumpUiHierarchy(serial);
    const nodes = parseUiNodes(xml);
    if (findVisibleText(nodes, expectedText)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

type TransitionMetrics = {
  thresholdRms: number;
  baselineRms: number;
  onsetMs: number | null;
  settledMs: number | null;
  latencyMs: number | null;
  stableForWindow: boolean;
};

export function expectedMuteToggleLabel(phase: "mute" | "unmute"): "Mute" | "Unmute" {
  return phase === "mute" ? "Mute" : "Unmute";
}

function isAudioFeatures(analysis: unknown): analysis is AudioFeatures {
  if (!analysis || typeof analysis !== "object") {
    return false;
  }

  const candidate = analysis as {
    envelope?: unknown;
    sampleRateHz?: unknown;
    rms?: unknown;
    peakAbs?: unknown;
    dominantFrequencyHz?: unknown;
    samplePairs?: unknown;
    stats?: unknown;
  };

  return (
    Array.isArray(candidate.envelope) &&
    typeof candidate.sampleRateHz === "number" &&
    typeof candidate.rms === "number" &&
    typeof candidate.peakAbs === "number" &&
    typeof candidate.dominantFrequencyHz === "number" &&
    typeof candidate.samplePairs === "number" &&
    !!candidate.stats &&
    typeof candidate.stats === "object"
  );
}

export function requireAudioFeatures(analysis: unknown, context: string): AudioFeatures {
  if (!analysis || typeof analysis !== "object" || !Array.isArray((analysis as { envelope?: unknown }).envelope)) {
    throw new Error(`Expected audio analysis with envelope data for ${context}.`);
  }
  if (!isAudioFeatures(analysis)) {
    throw new Error(`Expected complete audio analysis payload for ${context}.`);
  }
  return analysis;
}

function analyzeMuteTransition(features: AudioFeatures, tapAtMs: number): TransitionMetrics {
  const baselineRms = medianEnvelopeRms(features.envelope, { endMs: Math.max(0, tapAtMs - 80) });
  const thresholdRms = Math.max(0.001, Math.min(0.004, baselineRms * 0.18));
  const silentWindow = findFirstSustainedAudioState(features.envelope, {
    state: "silent",
    thresholdRms,
    requiredDurationMs: SILENCE_CONFIRM_MS,
    afterMs: tapAtMs,
  });
  const onsetMs = silentWindow.firstObservedAtMs;
  return {
    thresholdRms,
    baselineRms,
    onsetMs,
    settledMs: silentWindow.settledAtMs,
    latencyMs: onsetMs === null ? null : onsetMs - tapAtMs,
    stableForWindow:
      onsetMs !== null &&
      hasContinuousAudioState(features.envelope, {
        state: "silent",
        thresholdRms,
        startMs: onsetMs,
        durationMs: STABILITY_WINDOW_MS,
      }),
  };
}

function analyzeUnmuteTransition(features: AudioFeatures, tapAtMs: number, baselineRms: number): TransitionMetrics {
  const thresholdRms = Math.max(AUDIO_RMS_THRESHOLD, baselineRms * 0.45);
  const activeWindow = findFirstSustainedAudioState(features.envelope, {
    state: "active",
    thresholdRms,
    requiredDurationMs: ACTIVE_CONFIRM_MS,
    afterMs: tapAtMs,
  });
  const onsetMs = activeWindow.firstObservedAtMs;
  return {
    thresholdRms,
    baselineRms,
    onsetMs,
    settledMs: activeWindow.settledAtMs,
    latencyMs: onsetMs === null ? null : onsetMs - tapAtMs,
    stableForWindow:
      onsetMs !== null &&
      hasContinuousAudioState(features.envelope, {
        state: "active",
        thresholdRms,
        startMs: onsetMs,
        durationMs: STABILITY_WINDOW_MS,
      }),
  };
}

export const appFirstPlaybackContinuity: ValidationCase = {
  id: "AF-009",
  name: "App-first SID playback continuity across interruptions",
  caseId: "AF-PLAY-CONTINUITY-001",
  featureArea: "Play",
  route: "/play",
  safetyClass: "guarded-mutation",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "A/V signal", "Diagnostics and logs"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/play", "/settings", "/", "/play"],
      decisionLog: [
        `${ts()} Decision: discover SID candidates dynamically from the C64U mirrored test-data tree`,
        `${ts()} Decision: build a two-track SID playlist through the app-first Add items flow`,
        `${ts()} Decision: keep playback alive through tab changes, Home/background, and app switching`,
        `${ts()} Decision: confirm continuity with current-track UI, audio capture, and logcat`,
      ],
      safetyBudget: "guarded-mutation",
      oracleSelection: [
        "UI: current-track label remains on the first SID after interruptions",
        "A/V signal: C64U audio stream remains non-silent after recovery",
        "Diagnostics and logs: logcat retains BackgroundExecution service activity",
      ],
      recoveryActions: [] as string[],
    };

    const droidmind = new DroidmindClient();
    const playlistScreenshotPath = path.join(ctx.artifactDir, "af-playback-continuity.png");

    try {
      const targets = await discoverPlaybackTargets(ctx.c64uHost);
      trace.decisionLog.push(
        `${ts()} Observed: discovered SID candidates ${targets.sidCandidates.join(", ")} under ${targets.sidPath}`,
      );

      await ctx.store.recordStep({
        runId: ctx.runId,
        stepId: "step-01",
        route: "/play",
        featureArea: "Play",
        action: "discover_device_sid_candidates",
        peerServer: "c64bridge",
        primaryOracle: "FTP-visible state",
        bridgeFallbackCategory: "diagnostic_readback_only",
        bridgeFallbackJustification: "Read-only FTP discovery is required to dynamically select mirrored SID fixtures.",
        notes: `sidPath=${targets.sidPath}; candidates=${targets.sidCandidates.join(", ")}`,
      });

      await droidmind.connect();
      await launchAppForeground(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/play");
      await setDurationSeconds(droidmind, ctx.serial, 20);
      await addSidPlaylist(droidmind, ctx.serial, targets);
      await tapByResourceId(droidmind, ctx.serial, "playlist-play");

      const initialTrack = await waitForTrackLabel(
        ctx.serial,
        targets.sidCandidates[0],
        targets.sidCandidates,
        12,
        800,
      );
      trace.decisionLog.push(`${ts()} Observed: current track before interruptions='${initialTrack}'`);

      await ctx.store.recordStep({
        runId: ctx.runId,
        stepId: "step-02",
        route: "/play",
        featureArea: "Play",
        action: "start_sid_playlist_playback",
        peerServer: "mobile_controller",
        primaryOracle: "UI",
        fallbackOracle: "A/V signal",
        notes: `Started playback for ${targets.sidCandidates[0]} -> ${targets.sidCandidates[1]}`,
      });

      await navigateToRoute(droidmind, ctx.serial, "/settings");
      await navigateToRoute(droidmind, ctx.serial, "/");
      await navigateToRoute(droidmind, ctx.serial, "/play");
      await droidmind.pressKey(ctx.serial, 3);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await launchAppForeground(droidmind, ctx.serial);
      await droidmind.startApp(ctx.serial, "com.android.settings", ".Settings");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await launchAppForeground(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/play");

      const recoveredTrack = await readTopmostTrackLabel(ctx.serial, targets.sidCandidates);
      await droidmind.screenshotToFile(ctx.serial, playlistScreenshotPath);
      const continuityAudio = await captureAudioEvidence(ctx.c64uHost, ctx.artifactDir, "continuity-audio");
      const logcat = await capturePlaybackLogcat(ctx.serial, ctx.artifactDir, "continuity-logcat.txt");

      const rms = Number(continuityAudio.analysis.rms ?? 0);
      const continuityLogSeen = /BackgroundExecutionService|Scheduled dueAtMs watchdog|Service starting/i.test(
        logcat.text,
      );
      const continuityPassed = recoveredTrack === targets.sidCandidates[0] && rms >= AUDIO_RMS_THRESHOLD;
      trace.decisionLog.push(
        `${ts()} Observed: continuity ui=${recoveredTrack === targets.sidCandidates[0]}; audio=${rms >= AUDIO_RMS_THRESHOLD}; combined=${continuityPassed}`,
      );

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-continuity-screen",
        stepId: "step-02",
        evidenceType: "screenshot",
        summary: "Play page after tab/background/app-switch recovery",
        path: playlistScreenshotPath,
        metadata: {
          expectedTrack: targets.sidCandidates[0],
          observedTrack: recoveredTrack,
        },
      });

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-continuity-logcat",
        stepId: "step-02",
        evidenceType: "logcat",
        summary: "Logcat around playback continuity mission",
        path: logcat.path,
        metadata: {
          continuityLogSeen,
        },
      });

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-continuity-audio",
        stepId: "step-02",
        evidenceType: "signal_capture",
        summary: "Audio capture proving SID playback after recovery",
        path: continuityAudio.analysisPath,
        metadata: {
          packetsPath: continuityAudio.packetsPath,
          rms,
        },
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-01",
        title: "Playback remains on the original SID across tab, home, and app-switch interruptions",
        oracleClass: "UI",
        passed: recoveredTrack === targets.sidCandidates[0],
        details: {
          expectedTrack: targets.sidCandidates[0],
          observedTrack: recoveredTrack,
        },
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-02",
        title: "Recovered playback still emits non-silent audio",
        oracleClass: "A/V signal",
        passed: rms >= AUDIO_RMS_THRESHOLD,
        details: {
          rms,
          threshold: AUDIO_RMS_THRESHOLD,
          featureArea: "Play",
        },
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-03",
        title: "Playback continuity is corroborated by BackgroundExecution runtime logs",
        oracleClass: "Diagnostics and logs",
        passed: continuityLogSeen,
        details: {
          correlated: true,
          patterns: ["BackgroundExecutionService", "Service starting", "Scheduled dueAtMs watchdog"],
        },
      });

      return {
        assertions: [
          {
            oracleClass: "UI",
            passed: recoveredTrack === targets.sidCandidates[0],
            details: { expectedTrack: targets.sidCandidates[0], observedTrack: recoveredTrack },
          },
          {
            oracleClass: "A/V signal",
            passed: rms >= AUDIO_RMS_THRESHOLD,
            details: { rms, featureArea: "Play" },
          },
          {
            oracleClass: "Diagnostics and logs",
            passed: continuityLogSeen,
            details: { correlated: true },
          },
        ],
        explorationTrace: trace,
      };
    } finally {
      await droidmind.close();
    }
  },
};

export const appFirstPlaylistAutoAdvance: ValidationCase = {
  id: "AF-010",
  name: "App-first lock/background SID auto-advance",
  caseId: "AF-PLAY-AUTOSKIP-001",
  featureArea: "Play",
  route: "/play",
  safetyClass: "guarded-mutation",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "Diagnostics and logs", "A/V signal"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/play"],
      decisionLog: [
        `${ts()} Decision: discover two SID candidates dynamically from the mirrored C64U corpus`,
        `${ts()} Decision: force a short default duration so the background watchdog should fire quickly`,
        `${ts()} Decision: background and lock the device until the first SID should auto-advance`,
        `${ts()} Decision: verify the second SID is current with UI, watchdog logs, and audio capture`,
      ],
      safetyBudget: "guarded-mutation",
      oracleSelection: [
        "UI: topmost current-track label changes from first SID to second SID",
        "Diagnostics and logs: BackgroundExecutionService schedules and fires the dueAt watchdog",
        "A/V signal: post-unlock audio remains non-silent on the second track",
      ],
      recoveryActions: [] as string[],
    };

    const droidmind = new DroidmindClient();
    const screenshotPath = path.join(ctx.artifactDir, "af-playback-autoskip.png");

    try {
      const targets = await discoverPlaybackTargets(ctx.c64uHost);
      await droidmind.connect();
      await launchAppForeground(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/play");

      await ctx.store.recordStep({
        runId: ctx.runId,
        stepId: "step-01",
        route: "/play",
        featureArea: "Play",
        action: "discover_device_sid_candidates",
        peerServer: "c64bridge",
        primaryOracle: "FTP-visible state",
        bridgeFallbackCategory: "diagnostic_readback_only",
        bridgeFallbackJustification: "Read-only FTP discovery is required to dynamically select mirrored SID fixtures.",
        notes: `sidPath=${targets.sidPath}; candidates=${targets.sidCandidates.join(", ")}`,
      });

      await setDurationSeconds(droidmind, ctx.serial, 5);
      await addSidPlaylist(droidmind, ctx.serial, targets);
      await tapByResourceId(droidmind, ctx.serial, "playlist-play");
      const initialTrack = await waitForTrackLabel(
        ctx.serial,
        targets.sidCandidates[0],
        targets.sidCandidates,
        12,
        700,
      );
      trace.decisionLog.push(`${ts()} Observed: initial current track='${initialTrack}'`);

      await ctx.store.recordStep({
        runId: ctx.runId,
        stepId: "step-02",
        route: "/play",
        featureArea: "Play",
        action: "arm_background_auto_advance",
        peerServer: "mobile_controller",
        primaryOracle: "Diagnostics and logs",
        fallbackOracle: "UI",
        notes: `Duration forced to 5s for ${targets.sidCandidates[0]} -> ${targets.sidCandidates[1]}`,
      });

      await droidmind.pressKey(ctx.serial, 3);
      await new Promise((resolve) => setTimeout(resolve, 600));
      await droidmind.pressKey(ctx.serial, 26);
      await new Promise((resolve) => setTimeout(resolve, 7000));
      await droidmind.pressKey(ctx.serial, 26);
      await ensureDeviceUnlocked(droidmind, ctx.serial);
      await launchAppForeground(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/play");

      const advancedTrack = await waitForTrackLabel(
        ctx.serial,
        targets.sidCandidates[1],
        targets.sidCandidates,
        10,
        800,
      );
      const autoSkipLogcat = await capturePlaybackLogcat(ctx.serial, ctx.artifactDir, "autoskip-logcat.txt");
      const autoSkipAudio = await captureAudioEvidence(ctx.c64uHost, ctx.artifactDir, "autoskip-audio");
      await droidmind.screenshotToFile(ctx.serial, screenshotPath);

      const rms = Number(autoSkipAudio.analysis.rms ?? 0);
      const watchdogScheduled = /Scheduled dueAtMs watchdog/i.test(autoSkipLogcat.text);
      const watchdogFired = /Auto-skip watchdog fired/i.test(autoSkipLogcat.text);
      const logsPassed = watchdogScheduled && watchdogFired;

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-autoskip-screen",
        stepId: "step-02",
        evidenceType: "screenshot",
        summary: "Play page after lock/background auto-advance",
        path: screenshotPath,
        metadata: {
          expectedTrack: targets.sidCandidates[1],
          observedTrack: advancedTrack,
        },
      });

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-autoskip-logcat",
        stepId: "step-02",
        evidenceType: "logcat",
        summary: "Logcat around background auto-advance mission",
        path: autoSkipLogcat.path,
        metadata: {
          watchdogScheduled,
          watchdogFired,
        },
      });

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-autoskip-audio",
        stepId: "step-02",
        evidenceType: "signal_capture",
        summary: "Audio capture after lock/background auto-advance",
        path: autoSkipAudio.analysisPath,
        metadata: {
          packetsPath: autoSkipAudio.packetsPath,
          rms,
        },
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-01",
        title: "Current track advances exactly one SID while the device is backgrounded and locked",
        oracleClass: "UI",
        passed: advancedTrack === targets.sidCandidates[1],
        details: {
          expectedTrack: targets.sidCandidates[1],
          observedTrack: advancedTrack,
        },
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-02",
        title: "BackgroundExecution watchdog is scheduled and fired during the auto-advance window",
        oracleClass: "Diagnostics and logs",
        passed: logsPassed,
        details: {
          correlated: true,
          watchdogScheduled,
          watchdogFired,
        },
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-03",
        title: "Auto-advanced playback continues emitting audio on the second SID",
        oracleClass: "A/V signal",
        passed: rms >= AUDIO_RMS_THRESHOLD,
        details: {
          rms,
          threshold: AUDIO_RMS_THRESHOLD,
          featureArea: "Play",
        },
      });

      return {
        assertions: [
          {
            oracleClass: "UI",
            passed: advancedTrack === targets.sidCandidates[1],
            details: { expectedTrack: targets.sidCandidates[1], observedTrack: advancedTrack },
          },
          {
            oracleClass: "Diagnostics and logs",
            passed: logsPassed,
            details: { correlated: true },
          },
          {
            oracleClass: "A/V signal",
            passed: rms >= AUDIO_RMS_THRESHOLD,
            details: { rms, featureArea: "Play" },
          },
        ],
        explorationTrace: trace,
      };
    } finally {
      await droidmind.close();
    }
  },
};

export const appFirstPlaybackMuteLatency: ValidationCase = {
  id: "AF-011",
  name: "App-first SID mute and unmute latency stays within budget",
  caseId: "AF-PLAY-MUTE-LATENCY-001",
  featureArea: "Play",
  route: "/play",
  safetyClass: "guarded-mutation",
  validationTrack: "product",
  expectedOutcome: "pass",
  oracleClasses: ["UI", "A/V signal"],

  async run(ctx) {
    const trace = {
      routeDiscovery: ["/play"],
      decisionLog: [
        `${ts()} Decision: build a deterministic SID playlist on the real C64U source`,
        `${ts()} Decision: start concurrent UDP audio capture before each mute/unmute tap`,
        `${ts()} Decision: compute packet-envelope transitions to measure latency and 6s stability`,
      ],
      safetyBudget: "guarded-mutation",
      oracleSelection: [
        "UI: mute button flips to Unmute then back to Mute",
        "A/V signal: audio enters sustained silence and returns to sustained activity within 300ms",
      ],
      recoveryActions: [] as string[],
    };

    const droidmind = new DroidmindClient();
    const preMuteScreenshotPath = path.join(ctx.artifactDir, "af-playback-mute-before.png");
    const mutedScreenshotPath = path.join(ctx.artifactDir, "af-playback-muted.png");
    const unmutedScreenshotPath = path.join(ctx.artifactDir, "af-playback-unmuted.png");
    const metricsPath = path.join(ctx.artifactDir, "mute-latency-metrics.json");

    try {
      const targets = await discoverPlaybackTargets(ctx.c64uHost);
      trace.decisionLog.push(
        `${ts()} Observed: discovered SID candidates ${targets.sidCandidates.join(", ")} under ${targets.sidPath}`,
      );

      await droidmind.connect();
      await launchAppForeground(droidmind, ctx.serial);
      await navigateToRoute(droidmind, ctx.serial, "/play");
      await maybeClearPlaylist(droidmind, ctx.serial);
      await setDurationSeconds(droidmind, ctx.serial, 30);
      await addSidPlaylist(droidmind, ctx.serial, targets);
      await tapByResourceId(droidmind, ctx.serial, "playlist-play");
      await waitForTrackLabel(ctx.serial, targets.sidCandidates[0], targets.sidCandidates, 12, 800);
      await droidmind.screenshotToFile(ctx.serial, preMuteScreenshotPath);

      const muteCaptureStartedAt = Date.now();
      const muteCapturePromise = captureAndAnalyzeStream({
        streamType: "audio",
        c64uHost: ctx.c64uHost,
        artifactDir: path.join(ctx.artifactDir, "mute-transition-audio"),
        durationMs: MUTE_CAPTURE_DURATION_MS,
      });
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_PRE_ROLL_MS));
      const muteTapAtMs = Date.now() - muteCaptureStartedAt;
      const muteTapped = await tapByResourceIdOrLabel(droidmind, ctx.serial, "volume-mute", [expectedMuteToggleLabel("mute")]);
      if (!muteTapped) {
        throw new Error("Could not tap the Play mute button.");
      }
      const muteButtonFlipped = await waitForVisibleText(ctx.serial, "Unmute", 8, 250);
      await droidmind.screenshotToFile(ctx.serial, mutedScreenshotPath);
      const muteCapture = await muteCapturePromise;
      const muteMetrics = analyzeMuteTransition(
        requireAudioFeatures(muteCapture.analysis, "mute transition"),
        muteTapAtMs,
      );

      const unmuteCaptureStartedAt = Date.now();
      const unmuteCapturePromise = captureAndAnalyzeStream({
        streamType: "audio",
        c64uHost: ctx.c64uHost,
        artifactDir: path.join(ctx.artifactDir, "unmute-transition-audio"),
        durationMs: UNMUTE_CAPTURE_DURATION_MS,
      });
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_PRE_ROLL_MS));
      const unmuteTapAtMs = Date.now() - unmuteCaptureStartedAt;
      const unmuteTapped = await tapByResourceIdOrLabel(droidmind, ctx.serial, "volume-mute", [expectedMuteToggleLabel("unmute")]);
      if (!unmuteTapped) {
        throw new Error("Could not tap the Play unmute button.");
      }
      const unmuteButtonFlipped = await waitForVisibleText(ctx.serial, "Mute", 8, 250);
      await droidmind.screenshotToFile(ctx.serial, unmutedScreenshotPath);
      const unmuteCapture = await unmuteCapturePromise;
      const unmuteMetrics = analyzeUnmuteTransition(
        requireAudioFeatures(unmuteCapture.analysis, "unmute transition"),
        unmuteTapAtMs,
        muteMetrics.baselineRms,
      );

      const muteLatencyPassed =
        muteMetrics.latencyMs !== null && muteMetrics.latencyMs <= LATENCY_BUDGET_MS && muteMetrics.stableForWindow;
      const unmuteLatencyPassed =
        unmuteMetrics.latencyMs !== null &&
        unmuteMetrics.latencyMs <= LATENCY_BUDGET_MS &&
        unmuteMetrics.stableForWindow;

      const metrics = {
        latencyBudgetMs: LATENCY_BUDGET_MS,
        stabilityWindowMs: STABILITY_WINDOW_MS,
        muteTapAtMs,
        unmuteTapAtMs,
        muteMetrics,
        unmuteMetrics,
      };
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");

      await ctx.store.recordStep({
        runId: ctx.runId,
        stepId: "step-01",
        route: "/play",
        featureArea: "Play",
        action: "measure_play_mute_latency",
        peerServer: "mobile_controller",
        primaryOracle: "UI",
        fallbackOracle: "A/V signal",
        notes: `muteLatency=${muteMetrics.latencyMs ?? "missing"}ms; unmuteLatency=${unmuteMetrics.latencyMs ?? "missing"}ms`,
      });

      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-mute-before",
        stepId: "step-01",
        evidenceType: "screenshot",
        summary: "Play page before mute latency measurement",
        path: preMuteScreenshotPath,
      });
      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-mute-muted",
        stepId: "step-01",
        evidenceType: "screenshot",
        summary: "Play page after mute button transition",
        path: mutedScreenshotPath,
      });
      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-mute-unmuted",
        stepId: "step-01",
        evidenceType: "screenshot",
        summary: "Play page after unmute button transition",
        path: unmutedScreenshotPath,
      });
      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-mute-audio-mute",
        stepId: "step-01",
        evidenceType: "signal_capture",
        summary: "Audio envelope for mute transition latency and stability",
        path: muteCapture.analysisPath,
        metadata: {
          packetsPath: muteCapture.packetsPath,
          latencyMs: muteMetrics.latencyMs,
          thresholdRms: muteMetrics.thresholdRms,
        },
      });
      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-mute-audio-unmute",
        stepId: "step-01",
        evidenceType: "signal_capture",
        summary: "Audio envelope for unmute transition latency and stability",
        path: unmuteCapture.analysisPath,
        metadata: {
          packetsPath: unmuteCapture.packetsPath,
          latencyMs: unmuteMetrics.latencyMs,
          thresholdRms: unmuteMetrics.thresholdRms,
        },
      });
      await ctx.store.attachEvidence({
        runId: ctx.runId,
        evidenceId: "ev-af-playback-mute-metrics",
        stepId: "step-01",
        evidenceType: "analysis_json",
        summary: "Computed mute/unmute latency metrics",
        path: metricsPath,
      });

      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-01",
        title: "Mute button flips to Unmute after the Play mute tap",
        oracleClass: "UI",
        passed: muteButtonFlipped,
        details: { expectedLabel: "Unmute" },
      });
      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-02",
        title: "Mute drives the audio stream to sustained silence within 300 ms and keeps it silent for 6 s",
        oracleClass: "A/V signal",
        passed: muteLatencyPassed,
        details: muteMetrics,
      });
      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-03",
        title: "Unmute button flips back to Mute after the Play unmute tap",
        oracleClass: "UI",
        passed: unmuteButtonFlipped,
        details: { expectedLabel: "Mute" },
      });
      await ctx.store.recordAssertion({
        runId: ctx.runId,
        assertionId: "assert-04",
        title: "Unmute restores sustained audio within 300 ms and keeps it active for 6 s",
        oracleClass: "A/V signal",
        passed: unmuteLatencyPassed,
        details: unmuteMetrics,
      });

      trace.decisionLog.push(
        `${ts()} Observed: mute latency=${muteMetrics.latencyMs ?? "missing"}ms stable=${muteMetrics.stableForWindow}`,
      );
      trace.decisionLog.push(
        `${ts()} Observed: unmute latency=${unmuteMetrics.latencyMs ?? "missing"}ms stable=${unmuteMetrics.stableForWindow}`,
      );

      return {
        assertions: [
          { oracleClass: "UI", passed: muteButtonFlipped, details: { expectedLabel: "Unmute" } },
          { oracleClass: "A/V signal", passed: muteLatencyPassed, details: muteMetrics },
          { oracleClass: "UI", passed: unmuteButtonFlipped, details: { expectedLabel: "Mute" } },
          { oracleClass: "A/V signal", passed: unmuteLatencyPassed, details: unmuteMetrics },
        ],
        explorationTrace: trace,
      };
    } finally {
      await droidmind.close();
    }
  },
};
