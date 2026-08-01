/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Installing HVSC as four named steps, rather than one percentage.
 *
 * A single bar was tried twice and failed on the device both times. The reason is not arithmetic: the
 * counters behind it are not one continuous quantity. Each stage reports its own, in its own units —
 * bytes, then files, then songs — and when a stage hands over, its counters do not settle at their
 * final value, they **disappear**. Fusing them into one number therefore means guessing at weights for
 * stages whose durations vary by two orders of magnitude between a full install and an update, and
 * then patching over each handover as the terms collapse. Measured on the device, the result read 73%,
 * fell to 58%, froze for twenty seconds, and vanished without ever showing 100%.
 *
 * Steps do not have that problem. Which step is running is known exactly, and each step's own counter
 * is meaningful and monotonic within it. So the user is told the thing that is actually true —
 * which of four stages is running, which are finished, and how that one is doing — with no invented
 * weighting between them.
 *
 * The last step used to be labelled "meta", which named the implementation rather than the work.
 */

import type { HvscPreparationState } from "./hvscPreparationState";

/** The four steps, in the order they run. */
export type HvscStageId = "download" | "unpack" | "scan" | "details";

export type HvscStageStatus = "pending" | "active" | "done" | "failed";

export interface HvscStageStep {
  id: HvscStageId;
  /** What the user is told is happening. */
  label: string;
  /** One sentence saying what this step is actually doing. See `HVSC_STAGE_DESCRIPTIONS`. */
  description: string;
  status: HvscStageStatus;
}

export const HVSC_STAGE_LABELS: Record<HvscStageId, string> = {
  download: "Download",
  unpack: "Unpack",
  scan: "Find songs",
  details: "Song details",
};

/**
 * What each step is doing, in a sentence.
 *
 * The labels have to fit under a 24-pixel circle four across, so they are two words at most and say
 * almost nothing: "Unpack" and "Song details" name a step without explaining why the install has
 * been sitting on it for four minutes. These do explain it, and they matter most on the two long
 * steps — a first install spends the bulk of its time in "Song details", reading the header of
 * every one of sixty thousand files, and there is nothing on screen that says so.
 *
 * Only the running step's sentence is shown. All four at once is a paragraph on a phone, and three
 * of them describe work that is either finished or has not started.
 */
export const HVSC_STAGE_DESCRIPTIONS: Record<HvscStageId, string> = {
  download: "Fetching the archive from the High Voltage SID Collection.",
  unpack: "Decompressing the archive and writing the tunes to this device.",
  scan: "Listing every tune in the collection and where it lives.",
  details: "Reading each tune's name, composer and length. This is the long one.",
};

export const HVSC_STAGE_ORDER: HvscStageId[] = ["download", "unpack", "scan", "details"];

/**
 * Which step a raw progress stage belongs to.
 *
 * The stage vocabulary is the native ingestion runtime's, and is finer-grained than anything worth
 * showing: `archive_validation` and `archive_extraction` are both "unpacking" as far as the user is
 * concerned, and `songlengths`, `sid_metadata_parsing` and `database_insertion` are all "reading the
 * details of each song".
 */
const STAGE_TO_STEP: Record<string, HvscStageId> = {
  download: "download",
  archive_validation: "unpack",
  archive_extraction: "unpack",
  sid_enumeration: "scan",
  songlengths: "details",
  sid_metadata_parsing: "details",
  // The hydration pass reports under its own name. Leaving it unmapped showed "Unpack" as the running
  // step for the whole of it — observed on the device, stuck there for minutes while the panel below
  // plainly read "HVSC META 128/61,157".
  sid_metadata_hydration: "details",
  database_insertion: "details",
};

export const stepForStage = (stage: string | null | undefined): HvscStageId | null =>
  stage ? (STAGE_TO_STEP[stage] ?? null) : null;

export interface HvscStageInput {
  state: HvscPreparationState;
  /**
   * The running step, when the caller has worked it out from more than the raw stage.
   *
   * Takes precedence over `stage`, which is only populated by live progress events. Reopening the app
   * during an install leaves it null — the state is restored from the persisted summary, not replayed
   * — and without this the display fell back to the first ingest step. Observed on the device: "Unpack"
   * shown as running while the panel below read "HVSC META 128/61,157".
   */
  step?: HvscStageId | null;
  /** The most recent raw progress stage, if one has been reported. */
  stage?: string | null;
  /**
   * The coarse phase that failed, when the state is ERROR and no finer stage was reported.
   *
   * `stage` is preferred where it exists — it says which of the three ingest steps was running, where
   * the phase only distinguishes downloading from ingesting.
   */
  failedPhase?: "download" | "ingest" | null;
}

/**
 * The four steps and their statuses.
 *
 * Everything before the running step is finished and everything after it is not — which is true by
 * construction, because the stages are strictly ordered. No estimate is involved.
 */
export const hvscStageSteps = (input: HvscStageInput): HvscStageStep[] => {
  const build = (statusAt: (index: number) => HvscStageStatus): HvscStageStep[] =>
    HVSC_STAGE_ORDER.map((id, index) => ({
      id,
      label: HVSC_STAGE_LABELS[id],
      description: HVSC_STAGE_DESCRIPTIONS[id],
      status: statusAt(index),
    }));

  if (input.state === "READY") return build(() => "done");
  if (input.state === "NOT_PRESENT") return build(() => "pending");

  if (input.state === "ERROR") {
    const reported =
      input.step ?? stepForStage(input.stage) ?? (input.failedPhase === "ingest" ? "unpack" : "download");
    const failedAt = HVSC_STAGE_ORDER.indexOf(reported);
    return build((index) => (index < failedAt ? "done" : index === failedAt ? "failed" : "pending"));
  }

  if (input.state === "DOWNLOADING") return build((index) => (index === 0 ? "active" : "pending"));
  // The archive is fetched and unpacking has not started, so exactly one step is finished.
  if (input.state === "DOWNLOADED") return build((index) => (index === 0 ? "done" : "pending"));

  // INGESTING. The stage says which of the three remaining steps is running; before any stage has been
  // reported the earliest of them is the safe assumption, since ingestion always starts by unpacking.
  const activeIndex = Math.max(1, HVSC_STAGE_ORDER.indexOf(input.step ?? stepForStage(input.stage) ?? "unpack"));
  return build((index) => (index < activeIndex ? "done" : index === activeIndex ? "active" : "pending"));
};

/**
 * How far through the running step it is, 0–100, or null when that step has no meaningful counter.
 *
 * Scoped to the one step deliberately. Within a step the counter is a single quantity that only goes
 * up, which is exactly the case a percentage describes well — and the case the whole-install bar was
 * not.
 */
export const activeStepPercent = (percent: number | null | undefined): number | null => {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return null;
  return Math.min(100, Math.max(0, Math.round(percent)));
};

/**
 * "128 / 61,157" for the running step, when both counts are known.
 *
 * Preferred over the percentage because the counts move visibly from the first item, where a rounded
 * percentage of 61,157 songs reads 0% for the first six hundred of them. On the device that looked
 * exactly like the frozen bar it replaced.
 */
export const stageCountLabel = (done: number | null | undefined, total: number | null | undefined): string | null => {
  // A total of one is a placeholder, not a count: unpacking reported "1 / 1" on the device for the
  // whole of a stage that was plainly doing more than one thing.
  if (done === null || done === undefined || !total || total <= 1) return null;
  return `${Math.max(0, Math.round(done)).toLocaleString()} / ${Math.round(total).toLocaleString()}`;
};
