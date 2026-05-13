/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  analyzePlaybackLatencyEnvelope,
  summarizePlaybackLatency,
  type PlaybackLatencyOperation,
} from "../src/playbackVolumeLatencyMetrics.js";

describe("playback volume latency metrics", () => {
  it("extracts request-to-effect latency and summary stats from a synthetic envelope", () => {
    const envelope = [
      { receivedAtMs: 0, packetDurationMs: 50, rms: 0.58, peakAbs: 0.7, samplePairs: 512 },
      { receivedAtMs: 60, packetDurationMs: 50, rms: 0.57, peakAbs: 0.7, samplePairs: 512 },
      { receivedAtMs: 120, packetDurationMs: 50, rms: 0.3, peakAbs: 0.45, samplePairs: 512 },
      { receivedAtMs: 180, packetDurationMs: 50, rms: 0.29, peakAbs: 0.44, samplePairs: 512 },
      { receivedAtMs: 240, packetDurationMs: 50, rms: 0.28, peakAbs: 0.44, samplePairs: 512 },
      { receivedAtMs: 300, packetDurationMs: 50, rms: 0.02, peakAbs: 0.05, samplePairs: 512 },
      { receivedAtMs: 360, packetDurationMs: 50, rms: 0.01, peakAbs: 0.04, samplePairs: 512 },
      { receivedAtMs: 420, packetDurationMs: 50, rms: 0.56, peakAbs: 0.68, samplePairs: 512 },
      { receivedAtMs: 480, packetDurationMs: 50, rms: 0.57, peakAbs: 0.7, samplePairs: 512 },
      { receivedAtMs: 540, packetDurationMs: 50, rms: 0.58, peakAbs: 0.71, samplePairs: 512 },
    ];
    const operations: PlaybackLatencyOperation[] = [
      {
        id: "op-01",
        label: "volume:-12 dB",
        kind: "volume",
        requestedValue: "-12 dB",
        requestedState: "quiet",
        requestIssuedAtMs: 100,
        restDispatchedAtMs: 100,
        restCompletedAtMs: 110,
      },
      {
        id: "op-02",
        label: "mute:-42 dB",
        kind: "mute",
        requestedValue: "-42 dB",
        requestedState: "silent",
        requestIssuedAtMs: 260,
        restDispatchedAtMs: 260,
        restCompletedAtMs: 270,
      },
      {
        id: "op-03",
        label: "unmute:0 dB",
        kind: "unmute",
        requestedValue: "0 dB",
        requestedState: "loud",
        requestIssuedAtMs: 390,
        restDispatchedAtMs: 390,
        restCompletedAtMs: 400,
      },
    ];

    const metrics = analyzePlaybackLatencyEnvelope(envelope, operations, 650);

    expect(metrics).toHaveLength(3);
    expect(metrics[0]?.firstObservedAudioEffectAtMs).toBe(120);
    expect(metrics[0]?.totalLatencyMs).toBe(20);
    expect(metrics[0]?.finalTargetReached).toBe(true);
    expect(metrics[1]?.firstObservedAudioEffectAtMs).toBe(300);
    expect(metrics[1]?.totalLatencyMs).toBe(40);
    expect(metrics[1]?.finalTargetReached).toBe(true);
    expect(metrics[2]?.firstObservedAudioEffectAtMs).toBe(420);
    expect(metrics[2]?.totalLatencyMs).toBe(30);
    expect(metrics[2]?.staleIntermediateObserved).toBe(false);

    expect(summarizePlaybackLatency(metrics)).toEqual({
      count: 3,
      minMs: 20,
      medianMs: 30,
      p90Ms: 40,
      p95Ms: 40,
      maxMs: 40,
      failures: 0,
      staleWrites: 0,
      cancellations: 0,
    });
  });
});
