/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { medianEnvelopeRms } from "./stream/analysis.js";
import type { AudioEnvelopePoint } from "./stream/types.js";

export type PlaybackLatencyRequestedState = "loud" | "quiet" | "silent";

export interface PlaybackLatencyOperation {
    id: string;
    label: string;
    kind: "volume" | "mute" | "unmute";
    requestedValue: string;
    requestedState: PlaybackLatencyRequestedState;
    requestIssuedAtMs: number;
    restDispatchedAtMs: number;
    restCompletedAtMs: number | null;
    requestError?: string;
}

export interface PlaybackLatencyMetric extends PlaybackLatencyOperation {
    previousSteadyRms: number;
    targetSteadyRms: number;
    firstObservedAudioEffectAtMs: number | null;
    totalLatencyMs: number | null;
    staleIntermediateObserved: boolean;
    finalTargetReached: boolean;
}

export interface PlaybackLatencySummary {
    count: number;
    minMs: number | null;
    medianMs: number | null;
    p90Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    failures: number;
    staleWrites: number;
    cancellations: number;
}

const DEFAULT_WINDOW_TAIL_MS = 180;
const DEFAULT_REQUIRED_DURATION_MS = 80;
const MIN_DELTA_RMS = 0.01;

export function analyzePlaybackLatencyEnvelope(
    envelope: readonly AudioEnvelopePoint[],
    operations: readonly PlaybackLatencyOperation[],
    captureDurationMs: number,
): PlaybackLatencyMetric[] {
    return operations.map((operation, index) => {
        const previousBoundaryMs = index === 0 ? 0 : operations[index - 1]!.requestIssuedAtMs;
        const nextBoundaryMs = operations[index + 1]?.requestIssuedAtMs ?? captureDurationMs;
        const previousSteadyRms = tailMedianRms(envelope, previousBoundaryMs, operation.requestIssuedAtMs);
        const targetSteadyRms = tailMedianRms(envelope, operation.requestIssuedAtMs, nextBoundaryMs);
        const observedAtMs =
            operation.restCompletedAtMs === null
                ? null
                : findFirstSustainedTransition(envelope, {
                    afterMs: operation.requestIssuedAtMs,
                    untilMs: nextBoundaryMs,
                    previousSteadyRms,
                    targetSteadyRms,
                    requestedState: operation.requestedState,
                });
        const totalLatencyMs = observedAtMs === null ? null : Math.max(0, observedAtMs - operation.requestIssuedAtMs);
        const finalTargetReached = isFinalTargetReached(operation.requestedState, previousSteadyRms, targetSteadyRms);
        return {
            ...operation,
            previousSteadyRms,
            targetSteadyRms,
            firstObservedAudioEffectAtMs: observedAtMs,
            totalLatencyMs,
            staleIntermediateObserved: observedAtMs !== null && observedAtMs > nextBoundaryMs,
            finalTargetReached,
        };
    });
}

export function summarizePlaybackLatency(metrics: readonly PlaybackLatencyMetric[]): PlaybackLatencySummary {
    const samples = metrics
        .map((metric) => metric.totalLatencyMs)
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right);
    return {
        count: metrics.length,
        minMs: percentile(samples, 0),
        medianMs: percentile(samples, 0.5),
        p90Ms: percentile(samples, 0.9),
        p95Ms: percentile(samples, 0.95),
        maxMs: percentile(samples, 1),
        failures: metrics.filter(
            (metric) => metric.requestError || metric.firstObservedAudioEffectAtMs === null || !metric.finalTargetReached,
        ).length,
        staleWrites: metrics.filter((metric) => metric.staleIntermediateObserved).length,
        cancellations: metrics.filter((metric) => metric.requestError?.toLowerCase().includes("abort")).length,
    };
}

function tailMedianRms(envelope: readonly AudioEnvelopePoint[], startMs: number, endMs: number): number {
    const boundedEndMs = Math.max(startMs, endMs);
    const tailStartMs = Math.max(startMs, boundedEndMs - DEFAULT_WINDOW_TAIL_MS);
    return medianEnvelopeRms(envelope, { startMs: tailStartMs, endMs: boundedEndMs });
}

function findFirstSustainedTransition(
    envelope: readonly AudioEnvelopePoint[],
    options: {
        afterMs: number;
        untilMs: number;
        previousSteadyRms: number;
        targetSteadyRms: number;
        requestedState: PlaybackLatencyRequestedState;
    },
): number | null {
    const delta = options.targetSteadyRms - options.previousSteadyRms;
    if (options.requestedState !== "silent" && Math.abs(delta) < MIN_DELTA_RMS) {
        return null;
    }

    const silentThreshold = Math.max(options.targetSteadyRms * 1.5, 0.0125);
    const transitionThreshold = options.previousSteadyRms + delta * 0.5;

    for (const point of envelope) {
        const packetStartMs = point.receivedAtMs;
        if (packetStartMs < options.afterMs) {
            continue;
        }
        if (packetStartMs >= options.untilMs) {
            break;
        }

        const windowEndMs = Math.min(options.untilMs, packetStartMs + DEFAULT_REQUIRED_DURATION_MS);
        const windowMedianRms = medianEnvelopeRms(envelope, { startMs: packetStartMs, endMs: windowEndMs });

        const matches =
            options.requestedState === "silent"
                ? windowMedianRms <= silentThreshold
                : delta >= 0
                    ? windowMedianRms >= transitionThreshold
                    : windowMedianRms <= transitionThreshold;

        if (matches) {
            return packetStartMs;
        }
    }

    return null;
}

function isFinalTargetReached(
    requestedState: PlaybackLatencyRequestedState,
    previousSteadyRms: number,
    targetSteadyRms: number,
): boolean {
    if (requestedState === "silent") {
        return targetSteadyRms <= Math.max(previousSteadyRms * 0.25, 0.0125);
    }
    return Math.abs(targetSteadyRms - previousSteadyRms) >= MIN_DELTA_RMS;
}

function percentile(samples: readonly number[], fraction: number): number | null {
    if (!samples.length) {
        return null;
    }
    if (fraction <= 0) {
        return samples[0]!;
    }
    if (fraction >= 1) {
        return samples[samples.length - 1]!;
    }
    const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * fraction) - 1));
    return samples[index]!;
}
