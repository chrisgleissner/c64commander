/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadDeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";

type ProbeSnapshot = {
  lastProbeSucceededAtMs: number | null;
  lastProbeFailedAtMs: number | null;
};

const INFO_REFRESH_MIN_FLOOR_MS = 1_500;
export const INFO_REFRESH_MIN_CEILING_MS = 30_000;
export const DRIVES_POLL_INTERVAL_MS = 30_000;
export const DRIVES_POLL_INTERVAL_IDLE_MS = 60_000;
const BACKGROUND_REDISCOVERY_MAX_DELAY_MS = 60_000;

/**
 * Polling-pause registry.
 *
 * Sliders, drag-driven dialogs, and other "user is interacting now"
 * primitives can acquire a pause that suspends interval-driven background
 * refetches. Each acquisition returns a release function; pausing is
 * reference-counted so multiple concurrent drags don't trip over each other.
 *
 * Consumers (drives polling, info refresh, etc.) ask `isPollingPaused()`
 * before scheduling their tick.
 */
export type PollingPauseHandle = {
  release(): void;
};

type PollingPauseListener = () => void;

let pollingPauseCount = 0;
const pollingPauseListeners = new Set<PollingPauseListener>();

const notifyPollingPauseListeners = () => {
  pollingPauseListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      // Listener crashes must not break the registry's invariants.
      console.warn("pollingPauseRegistry listener threw", error);
    }
  });
};

export const pollingPauseRegistry = {
  acquirePause(): PollingPauseHandle {
    pollingPauseCount += 1;
    if (pollingPauseCount === 1) notifyPollingPauseListeners();
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        pollingPauseCount = Math.max(0, pollingPauseCount - 1);
        if (pollingPauseCount === 0) notifyPollingPauseListeners();
      },
    };
  },
  isPollingPaused(): boolean {
    return pollingPauseCount > 0;
  },
  subscribe(listener: PollingPauseListener): () => void {
    pollingPauseListeners.add(listener);
    return () => {
      pollingPauseListeners.delete(listener);
    };
  },
  /** Test-only: reset the registry. Do not call from production code. */
  __resetForTest(): void {
    pollingPauseCount = 0;
    pollingPauseListeners.clear();
  },
};

export const getInfoRefreshMinIntervalMs = () => {
  const safety = loadDeviceSafetyConfig();
  const candidate = Math.max(safety.infoCacheMs * 2, safety.configsCooldownMs);
  return Math.min(INFO_REFRESH_MIN_CEILING_MS, Math.max(INFO_REFRESH_MIN_FLOOR_MS, candidate));
};

export const getDrivesPollIntervalMs = () => {
  const safety = loadDeviceSafetyConfig();
  return safety.resolution?.effectiveMode === "CONSERVATIVE" || safety.mode === "CONSERVATIVE"
    ? DRIVES_POLL_INTERVAL_IDLE_MS
    : DRIVES_POLL_INTERVAL_MS;
};

export const shouldRunRateLimited = (lastRunAtMs: number | null, minIntervalMs: number, nowMs = Date.now()) => {
  if (!lastRunAtMs) return true;
  return nowMs - lastRunAtMs >= Math.max(0, minIntervalMs);
};

export const getNextBackgroundFailureCount = (previousFailureCount: number, snapshot: ProbeSnapshot) => {
  const { lastProbeSucceededAtMs, lastProbeFailedAtMs } = snapshot;
  if (lastProbeSucceededAtMs === null && lastProbeFailedAtMs === null) {
    return previousFailureCount;
  }
  if (
    lastProbeSucceededAtMs !== null &&
    (lastProbeFailedAtMs === null || lastProbeSucceededAtMs >= lastProbeFailedAtMs)
  ) {
    return 0;
  }
  return Math.min(previousFailureCount + 1, 6);
};

export const getBackgroundRediscoveryDelayMs = (baseIntervalMs: number, failureCount: number) => {
  const safeBaseMs = Math.max(1_000, baseIntervalMs);
  const exponent = Math.max(0, Math.min(6, Math.floor(failureCount)));
  const delay = safeBaseMs * 2 ** exponent;
  return Math.min(delay, BACKGROUND_REDISCOVERY_MAX_DELAY_MS);
};
