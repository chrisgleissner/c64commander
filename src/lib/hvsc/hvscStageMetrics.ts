/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HvscProgressEvent } from "./hvscTypes";
import { HVSC_STAGE_ORDER, stepForStage, type HvscStageId } from "./hvscStageIds";

/**
 * What one install step did, measured by that step alone.
 *
 * The progress events carry `elapsedTimeMs` counted from the start of the whole run, so a rate
 * computed from it spreads a step's items over every earlier step as well, and keeps falling while
 * later steps run. These measurements start when the step's first event arrives and stop when the
 * next step's first event arrives.
 */
export type HvscStageMeasurement = {
  startedAtMs: number;
  finishedAtMs: number | null;
  processed: number | null;
  total: number | null;
  /** When the count last changed. The rate is measured up to here, so a step that goes quiet does not keep slowing. */
  lastProgressAtMs?: number;
};

export type HvscStageMeasurements = Partial<Record<HvscStageId, HvscStageMeasurement>>;

const countsOf = (stage: HvscStageId, event: HvscProgressEvent) =>
  stage === "download"
    ? { processed: event.downloadedBytes ?? null, total: event.totalBytes ?? null }
    : {
        processed: event.processedCount ?? event.ingestedSongs ?? null,
        total: event.totalCount ?? event.totalSongs ?? null,
      };

const isStepFinishedByEvent = (
  stage: HvscStageId,
  event: HvscProgressEvent,
  counts: { processed: number | null; total: number | null },
) => {
  if (stage === "analyze") return event.statusToken === "done" || event.statusToken === "error";
  if (stage === "download")
    return counts.total !== null && counts.total > 0 && counts.processed !== null && counts.processed >= counts.total;
  return false;
};

const isStartOfAnalysis = (event: HvscProgressEvent) => event.statusToken === "queued" || event.processedCount === 0;

const finishStepsBefore = (measurements: HvscStageMeasurements, index: number, nowMs: number) => {
  HVSC_STAGE_ORDER.slice(0, index).forEach((id) => {
    const earlier = measurements[id];
    if (earlier && earlier.finishedAtMs === null) measurements[id] = { ...earlier, finishedAtMs: nowMs };
  });
};

export const applyHvscStageEvent = (
  current: HvscStageMeasurements | undefined,
  event: HvscProgressEvent,
  nowMs: number,
): HvscStageMeasurements => {
  const measurements: HvscStageMeasurements = { ...current };

  if (event.stage === "start") return {};

  if (event.stage === "complete") {
    finishStepsBefore(measurements, HVSC_STAGE_ORDER.indexOf("analyze"), nowMs);
    return measurements;
  }

  const stage = stepForStage(event.stage);
  if (!stage) return measurements;

  if (stage !== "analyze") finishStepsBefore(measurements, HVSC_STAGE_ORDER.indexOf(stage), nowMs);

  let existing = measurements[stage];
  if (stage === "analyze" && isStartOfAnalysis(event)) existing = undefined;
  if (existing?.finishedAtMs != null) return measurements;

  const counts = countsOf(stage, event);
  const processed = counts.processed ?? existing?.processed ?? null;
  const countMoved = processed !== null && processed !== existing?.processed;
  const lastProgressAtMs = countMoved ? nowMs : existing?.lastProgressAtMs;
  const next: HvscStageMeasurement = {
    startedAtMs: existing?.startedAtMs ?? nowMs,
    finishedAtMs: existing?.finishedAtMs ?? null,
    processed,
    total: counts.total ?? existing?.total ?? null,
    ...(lastProgressAtMs === undefined ? {} : { lastProgressAtMs }),
  };
  if (isStepFinishedByEvent(stage, event, counts)) next.finishedAtMs = nowMs;
  measurements[stage] = next;
  return measurements;
};
