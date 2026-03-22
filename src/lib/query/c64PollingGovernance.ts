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
const BACKGROUND_REDISCOVERY_MAX_DELAY_MS = 60_000;

export const getInfoRefreshMinIntervalMs = () => {
  const safety = loadDeviceSafetyConfig();
  const candidate = Math.max(safety.infoCacheMs * 2, safety.configsCooldownMs);
  return Math.min(INFO_REFRESH_MIN_CEILING_MS, Math.max(INFO_REFRESH_MIN_FLOOR_MS, candidate));
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
