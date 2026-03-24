/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  degradePlaybackConfidence,
  getDecisionStateSnapshot,
  markPlaybackUncertain,
  resetDecisionStateSnapshot,
  setPlaybackDecisionState,
  setReconcilerState,
  setRepairState,
  syncPlaybackDecisionFromTrace,
} from "@/lib/diagnostics/decisionState";

describe("decisionState", () => {
  beforeEach(() => {
    resetDecisionStateSnapshot();
  });

  afterEach(() => {
    resetDecisionStateSnapshot();
  });

  it("records a playback transition when state or confidence changes", () => {
    setPlaybackDecisionState({
      state: "PLAYING",
      confidence: "HIGH",
      reason: "Playback detected",
      sourceKind: "hvsc",
      currentItemId: "item-1",
      elapsedMs: 1234,
      lastUpdatedAt: "2025-01-01T00:00:00.000Z",
    });

    const snapshot = getDecisionStateSnapshot();
    expect(snapshot.playback.state).toBe("PLAYING");
    expect(snapshot.playback.confidence).toBe("HIGH");
    expect(snapshot.transitions).toHaveLength(1);
    expect(snapshot.transitions[0]).toMatchObject({
      target: "playback",
      from: "UNKNOWN:LOW",
      to: "PLAYING:HIGH",
      reason: "Playback detected",
    });
  });

  it("does not append a playback transition when the state and confidence are unchanged", () => {
    setPlaybackDecisionState({
      state: "PLAYING",
      confidence: "HIGH",
      reason: "Playback detected",
      sourceKind: "hvsc",
      currentItemId: "item-1",
      elapsedMs: 1234,
      lastUpdatedAt: "2025-01-01T00:00:00.000Z",
    });
    setPlaybackDecisionState({
      state: "PLAYING",
      confidence: "HIGH",
      reason: "Same state",
      sourceKind: "hvsc",
      currentItemId: "item-1",
      elapsedMs: 4567,
      lastUpdatedAt: "2025-01-01T00:00:05.000Z",
    });

    expect(getDecisionStateSnapshot().transitions).toHaveLength(1);
  });

  it("maps playback traces to PLAYING, STOPPED, and UNKNOWN states", () => {
    syncPlaybackDecisionFromTrace(
      {
        isPlaying: true,
        sourceKind: "hvsc",
        currentItemId: "song-1",
        elapsedMs: 2222,
      },
      "trace says playing",
    );
    expect(getDecisionStateSnapshot().playback).toMatchObject({
      state: "PLAYING",
      confidence: "HIGH",
      sourceKind: "hvsc",
      currentItemId: "song-1",
      elapsedMs: 2222,
      reason: "trace says playing",
    });

    syncPlaybackDecisionFromTrace(
      {
        isPlaying: false,
        sourceKind: null,
        currentItemId: null,
        elapsedMs: null,
      },
      "trace says stopped",
    );
    expect(getDecisionStateSnapshot().playback).toMatchObject({
      state: "STOPPED",
      confidence: "HIGH",
      sourceKind: null,
      reason: "trace says stopped",
    });

    syncPlaybackDecisionFromTrace(null, "trace missing");
    expect(getDecisionStateSnapshot().playback).toMatchObject({
      state: "UNKNOWN",
      confidence: "LOW",
      sourceKind: null,
      currentItemId: null,
      elapsedMs: null,
      reason: "trace missing",
    });
  });

  it("degrades playback confidence only after the configured age thresholds", () => {
    expect(degradePlaybackConfidence("no timestamp", Date.parse("2025-01-01T00:00:10.000Z"))).toMatchObject({
      state: "UNKNOWN",
      confidence: "LOW",
    });

    setPlaybackDecisionState({
      state: "PLAYING",
      confidence: "HIGH",
      reason: "Fresh playback",
      sourceKind: "hvsc",
      currentItemId: "song-1",
      elapsedMs: 50,
      lastUpdatedAt: "2025-01-01T00:00:00.000Z",
    });

    expect(degradePlaybackConfidence("still fresh", Date.parse("2025-01-01T00:00:05.000Z"))).toMatchObject({
      confidence: "HIGH",
    });

    expect(degradePlaybackConfidence("aging", Date.parse("2025-01-01T00:00:20.000Z"))).toMatchObject({
      confidence: "MEDIUM",
      reason: "aging",
    });

    expect(degradePlaybackConfidence("stale", Date.parse("2025-01-01T00:01:25.000Z"))).toMatchObject({
      confidence: "LOW",
      reason: "stale",
    });
  });

  it("marks playback uncertain with the requested confidence", () => {
    setPlaybackDecisionState({
      state: "PLAYING",
      confidence: "HIGH",
      reason: "Playback detected",
      sourceKind: "hvsc",
      currentItemId: "song-1",
      elapsedMs: 123,
      lastUpdatedAt: "2025-01-01T00:00:00.000Z",
    });

    markPlaybackUncertain("Transport desynced", "MEDIUM");

    expect(getDecisionStateSnapshot().playback).toMatchObject({
      state: "UNKNOWN",
      confidence: "MEDIUM",
      reason: "Transport desynced",
    });
  });

  it("records reconciler transitions only when the result changes", () => {
    setReconcilerState(
      "config",
      {
        result: "running",
        lastRunAt: "2025-01-01T00:00:10.000Z",
        driftDetected: true,
        actionsTaken: ["refresh"],
        detail: "Checking drift",
      },
      "started repair",
    );

    setReconcilerState("config", {
      result: "running",
      lastRunAt: "2025-01-01T00:00:11.000Z",
      driftDetected: false,
      actionsTaken: [],
      detail: null,
    });

    setReconcilerState("config", {
      result: "success",
      lastRunAt: "2025-01-01T00:00:12.000Z",
      driftDetected: false,
      actionsTaken: ["synced"],
      detail: "Repair complete",
    });

    const snapshot = getDecisionStateSnapshot();
    expect(snapshot.reconcilers.config).toMatchObject({
      result: "success",
      actionsTaken: ["synced"],
      detail: "Repair complete",
    });
    expect(snapshot.transitions).toHaveLength(2);
    expect(snapshot.transitions[1]).toMatchObject({
      target: "config",
      from: "running",
      to: "success",
      reason: "Repair complete",
    });
  });

  it("stores repair metadata", () => {
    setRepairState("running", "2025-01-01T00:00:30.000Z");
    expect(getDecisionStateSnapshot()).toMatchObject({
      lastRepairAt: "2025-01-01T00:00:30.000Z",
      lastRepairResult: "running",
    });
  });
});