/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { captureAndAnalyzeStream } from "../../stream/index.js";
import { discoverDeviceMirror } from "../../testDataDiscovery.js";
import { DroidmindClient } from "../droidmindClient.js";
import {
  launchAppForeground,
  navigateToRoute,
  ensureDeviceUnlocked,
  tapByResourceId,
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
import { captureLogcat, ts } from "../helpers.js";
import type { ValidationCase } from "../types.js";

const AUDIO_RMS_THRESHOLD = 0.005;
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
