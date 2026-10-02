/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getTraceEvents } from "@/lib/tracing/traceSession";
import type { TraceEvent } from "@/lib/tracing/types";
import {
  createHealthTraceIndex,
  deriveTraceHealth,
  type PinnedHealthCheck,
  type TraceHealth,
} from "@/lib/diagnostics/traceHealth";

// A search keystroke records about two traces; health is re-derived at most once per burst.
export const HEALTH_TRACE_COALESCE_MS = 250;
// Problems age out of time windows, so health is re-derived while it reports any, even with no new trace.
export const HEALTH_PROBLEM_RECHECK_MS = 10_000;

const listeners = new Set<() => void>();
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let cachedEvents: TraceEvent[] | null = null;

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

const flushTraceUpdates = () => {
  coalesceTimer = null;
  notifyListeners();
};

const onTracesUpdated = () => {
  if (coalesceTimer !== null) return;
  coalesceTimer = setTimeout(flushTraceUpdates, HEALTH_TRACE_COALESCE_MS);
};

/**
 * Notifies `listener` after trace updates, at most once per HEALTH_TRACE_COALESCE_MS. The timer
 * starts at the first update of a burst and fires after the last one too, so the final state is
 * always delivered. All subscribers share one window listener and one timer.
 */
export const subscribeHealthTraceUpdates = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("c64u-traces-updated", onTracesUpdated);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener("c64u-traces-updated", onTracesUpdated);
    if (coalesceTimer !== null) {
      clearTimeout(coalesceTimer);
      coalesceTimer = null;
    }
  };
};

const haveSameTraceContents = (cached: TraceEvent[], fresh: TraceEvent[]) =>
  cached === fresh ||
  (fresh.length > 0 &&
    cached.length === fresh.length &&
    cached[0] === fresh[0] &&
    cached[cached.length - 1] === fresh[fresh.length - 1]);

/** The trace events, as the same array for every reader until the store changes. */
export const readHealthTraceEvents = (): TraceEvent[] => {
  const fresh = getTraceEvents();
  if (cachedEvents && haveSameTraceContents(cachedEvents, fresh)) return cachedEvents;
  cachedEvents = fresh;
  return fresh;
};

let recheckGeneration = 0;
let recheckRetainers = 0;
let recheckTimer: ReturnType<typeof setInterval> | null = null;

export const getHealthRecheckGeneration = () => recheckGeneration;

/** Keeps one shared recheck timer running while any caller holds it. Returns the release. */
export const retainHealthProblemRecheck = () => {
  recheckRetainers += 1;
  if (recheckTimer === null) {
    recheckTimer = setInterval(() => {
      recheckGeneration += 1;
      notifyListeners();
    }, HEALTH_PROBLEM_RECHECK_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    recheckRetainers -= 1;
    if (recheckRetainers === 0 && recheckTimer !== null) {
      clearInterval(recheckTimer);
      recheckTimer = null;
    }
  };
};

export type SharedTraceHealthInput = {
  events: TraceEvent[];
  host: string;
  deviceId: string | null;
  latestHealthCheck: PinnedHealthCheck | null;
  recheckGeneration: number;
};

const sharedIndex = createHealthTraceIndex();
let lastDerivation: { input: SharedTraceHealthInput; result: TraceHealth } | null = null;

const isSameInput = (left: SharedTraceHealthInput, right: SharedTraceHealthInput) =>
  left.events === right.events &&
  left.host === right.host &&
  left.deviceId === right.deviceId &&
  left.latestHealthCheck === right.latestHealthCheck &&
  left.recheckGeneration === right.recheckGeneration;

/**
 * Every health consumer reads the same derivation: the badge and the diagnostics overlay render
 * from one trace update, so the second caller gets the first caller's result.
 */
export const selectSharedTraceHealth = (input: SharedTraceHealthInput): TraceHealth => {
  if (lastDerivation && isSameInput(lastDerivation.input, input)) {
    return lastDerivation.result;
  }
  const result = deriveTraceHealth(
    {
      events: input.events,
      host: input.host,
      deviceId: input.deviceId,
      latestHealthCheck: input.latestHealthCheck,
      nowMs: Date.now(),
    },
    sharedIndex,
  );
  lastDerivation = { input, result };
  return result;
};
