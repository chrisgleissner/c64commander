/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { type HvscStageId } from "./hvscStageIds";
import type { HvscStageMeasurement } from "./hvscStageMetrics";

const MIN_ELAPSED_FOR_RATE_MS = 1000;
const MIN_ELAPSED_FOR_ESTIMATE_MS = 3000;

export const stageElapsedMs = (measurement: HvscStageMeasurement, nowMs: number) =>
  Math.max(0, (measurement.finishedAtMs ?? measurement.lastProgressAtMs ?? nowMs) - measurement.startedAtMs);

/** Items per second within this step alone, or null before there is enough to say. */
export const stageRatePerSecond = (measurement: HvscStageMeasurement | undefined, nowMs: number): number | null => {
  if (!measurement || !measurement.processed || measurement.processed <= 0) return null;
  const elapsedMs = stageElapsedMs(measurement, nowMs);
  if (elapsedMs < MIN_ELAPSED_FOR_RATE_MS) return null;
  return measurement.processed / (elapsedMs / 1000);
};

/** Time left in this step at its own rate so far, or null when it cannot be said honestly. */
export const stageRemainingMs = (measurement: HvscStageMeasurement | undefined, nowMs: number): number | null => {
  if (!measurement || measurement.finishedAtMs !== null) return null;
  if (!measurement.total || measurement.total <= 1 || measurement.processed === null) return null;
  if (stageElapsedMs(measurement, nowMs) < MIN_ELAPSED_FOR_ESTIMATE_MS) return null;
  const rate = stageRatePerSecond(measurement, nowMs);
  if (rate === null || measurement.processed >= measurement.total) return null;
  return ((measurement.total - measurement.processed) / rate) * 1000;
};

export const formatRemaining = (remainingMs: number): string => {
  const seconds = Math.max(1, Math.round(remainingMs / 1000));
  if (seconds < 90) return `about ${seconds} s left`;
  return `about ${Math.round(seconds / 60)} min left`;
};

const RATE_UNIT: Record<HvscStageId, string> = {
  download: "MB/s",
  unpack: "files/s",
  scan: "songs/s",
  details: "songs/s",
  analyze: "songs/s",
};

const formatRate = (stage: HvscStageId, perSecond: number) => {
  const value = stage === "download" ? perSecond / 1024 / 1024 : perSecond;
  const text = value >= 10 ? Math.round(value).toLocaleString() : value.toFixed(1);
  return `${text} ${RATE_UNIT[stage]}`;
};

/** "13 MB/s · about 2 min left" for the running step, from that step's own measurement. */
export const stageDetailLabel = (
  stage: HvscStageId | null,
  measurement: HvscStageMeasurement | undefined,
  nowMs: number,
): string | null => {
  if (!stage) return null;
  const rate = stageRatePerSecond(measurement, nowMs);
  if (rate === null) return null;
  const remaining = stageRemainingMs(measurement, nowMs);
  return [formatRate(stage, rate), remaining === null ? null : formatRemaining(remaining)].filter(Boolean).join(" · ");
};
