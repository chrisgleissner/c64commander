/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import type { TracePlaybackContext } from "@/lib/tracing/types";

export type PlaybackObservedState = "PLAYING" | "STOPPED" | "UNKNOWN";
export type PlaybackConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ReconcilerKey = "config" | "playback" | "diagnostics";
export type ReconcilerResult = "idle" | "running" | "success" | "failure";

export type PlaybackDecisionState = {
  state: PlaybackObservedState;
  confidence: PlaybackConfidence;
  lastUpdatedAt: string | null;
  reason: string | null;
  sourceKind: TracePlaybackContext["sourceKind"] | null;
  currentItemId: string | null;
  elapsedMs: number | null;
};

export type ReconcilerState = {
  key: ReconcilerKey;
  lastRunAt: string | null;
  result: ReconcilerResult;
  driftDetected: boolean | null;
  actionsTaken: string[];
  detail: string | null;
};

export type DecisionTransition = {
  id: string;
  timestamp: string;
  domain: "playback" | "reconciler";
  target: string;
  from: string | null;
  to: string;
  reason: string | null;
};

export type DecisionStateSnapshot = {
  playback: PlaybackDecisionState;
  reconcilers: Record<ReconcilerKey, ReconcilerState>;
  transitions: DecisionTransition[];
  lastRepairAt: string | null;
  lastRepairResult: "idle" | "running" | "success" | "failure";
};

const createTransitionId = () => `decision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createDefaultReconcilerState = (key: ReconcilerKey): ReconcilerState => ({
  key,
  lastRunAt: null,
  result: "idle",
  driftDetected: null,
  actionsTaken: [],
  detail: null,
});

const defaultSnapshot = (): DecisionStateSnapshot => ({
  playback: {
    state: "UNKNOWN",
    confidence: "LOW",
    lastUpdatedAt: null,
    reason: null,
    sourceKind: null,
    currentItemId: null,
    elapsedMs: null,
  },
  reconcilers: {
    config: createDefaultReconcilerState("config"),
    playback: createDefaultReconcilerState("playback"),
    diagnostics: createDefaultReconcilerState("diagnostics"),
  },
  transitions: [],
  lastRepairAt: null,
  lastRepairResult: "idle",
});

let snapshot: DecisionStateSnapshot = defaultSnapshot();
const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const pushTransition = (transition: Omit<DecisionTransition, "id">) => {
  snapshot = {
    ...snapshot,
    transitions: [...snapshot.transitions, { ...transition, id: createTransitionId() }].slice(-50),
  };
};

const setSnapshot = (next: Partial<DecisionStateSnapshot>) => {
  snapshot = {
    ...snapshot,
    ...next,
  };
  emit();
};

export const getDecisionStateSnapshot = () => snapshot;

export const subscribeDecisionState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useDecisionState = () =>
  useSyncExternalStore(subscribeDecisionState, getDecisionStateSnapshot, getDecisionStateSnapshot);

export const resetDecisionStateSnapshot = () => {
  snapshot = defaultSnapshot();
  emit();
};

export const setPlaybackDecisionState = (
  next: Omit<PlaybackDecisionState, "lastUpdatedAt"> & { lastUpdatedAt?: string | null },
) => {
  const previous = snapshot.playback;
  const nextState: PlaybackDecisionState = {
    ...previous,
    ...next,
    lastUpdatedAt: next.lastUpdatedAt ?? new Date().toISOString(),
  };
  if (previous.state !== nextState.state || previous.confidence !== nextState.confidence) {
    pushTransition({
      timestamp: nextState.lastUpdatedAt ?? new Date().toISOString(),
      domain: "playback",
      target: "playback",
      from: `${previous.state}:${previous.confidence}`,
      to: `${nextState.state}:${nextState.confidence}`,
      reason: nextState.reason,
    });
  }
  snapshot = {
    ...snapshot,
    playback: nextState,
  };
  emit();
};

export const syncPlaybackDecisionFromTrace = (trace: TracePlaybackContext | null, reason = "playback trace update") => {
  if (!trace) {
    setPlaybackDecisionState({
      state: "UNKNOWN",
      confidence: "LOW",
      reason,
      sourceKind: null,
      currentItemId: null,
      elapsedMs: null,
    });
    return;
  }

  setPlaybackDecisionState({
    state: trace.isPlaying ? "PLAYING" : "STOPPED",
    confidence: "HIGH",
    reason,
    sourceKind: trace.sourceKind ?? null,
    currentItemId: trace.currentItemId,
    elapsedMs: trace.elapsedMs,
  });
};

export const degradePlaybackConfidence = (reason = "confidence decay", nowMs = Date.now()) => {
  const playback = snapshot.playback;
  const lastUpdatedMs = playback.lastUpdatedAt ? Date.parse(playback.lastUpdatedAt) : null;
  if (lastUpdatedMs === null || Number.isNaN(lastUpdatedMs)) return playback;
  const ageMs = Math.max(0, nowMs - lastUpdatedMs);
  const nextConfidence: PlaybackConfidence = ageMs >= 60_000 ? "LOW" : ageMs >= 15_000 ? "MEDIUM" : playback.confidence;
  if (nextConfidence === playback.confidence) return playback;
  setPlaybackDecisionState({
    ...playback,
    confidence: nextConfidence,
    reason,
    lastUpdatedAt: new Date(nowMs).toISOString(),
  });
  return getDecisionStateSnapshot().playback;
};

export const markPlaybackUncertain = (reason: string, confidence: PlaybackConfidence = "LOW") => {
  setPlaybackDecisionState({
    ...snapshot.playback,
    state: "UNKNOWN",
    confidence,
    reason,
    lastUpdatedAt: new Date().toISOString(),
  });
};

export const setReconcilerState = (
  key: ReconcilerKey,
  updates: Partial<Omit<ReconcilerState, "key">>,
  transitionReason?: string | null,
) => {
  const previous = snapshot.reconcilers[key];
  const next: ReconcilerState = {
    ...previous,
    ...updates,
    key,
  };
  if (previous.result !== next.result) {
    pushTransition({
      timestamp: next.lastRunAt ?? new Date().toISOString(),
      domain: "reconciler",
      target: key,
      from: previous.result,
      to: next.result,
      reason: transitionReason ?? next.detail,
    });
  }
  snapshot = {
    ...snapshot,
    reconcilers: {
      ...snapshot.reconcilers,
      [key]: next,
    },
  };
  emit();
};

export const setRepairState = (result: DecisionStateSnapshot["lastRepairResult"], at = new Date().toISOString()) => {
  setSnapshot({
    lastRepairAt: at,
    lastRepairResult: result,
  });
};
