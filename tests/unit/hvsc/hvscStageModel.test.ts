/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The single percentage was tried twice and failed on the device both times — it read 73%, fell to
 * 58%, froze for twenty seconds, then vanished without ever reaching 100%. These tests pin the
 * property that replaced it: which stage is running is stated exactly, and never contradicts itself.
 */

import { describe, expect, it } from "vitest";
import {
  HVSC_STAGE_ORDER,
  activeStepPercent,
  hvscStageSteps,
  stageCountLabel,
  stepForStage,
  type HvscStageId,
} from "@/lib/hvsc/hvscStageModel";

const statuses = (input: Parameters<typeof hvscStageSteps>[0]) => hvscStageSteps(input).map((step) => step.status);
const idOf = (input: Parameters<typeof hvscStageSteps>[0]) =>
  hvscStageSteps(input).find((step) => step.status === "active")?.id ?? null;

describe("installing HVSC as four named steps", () => {
  it("names the last step after the work, not the implementation", () => {
    // It read "meta" on the device, next to a number that meant nothing to anyone who had not read
    // the ingestion runtime.
    const labels = hvscStageSteps({ state: "NOT_PRESENT" }).map((step) => step.label);
    expect(labels).toEqual(["Download", "Unpack", "Find songs", "Song details"]);
  });

  it("marks exactly one step active at a time while working", () => {
    const working = [
      { state: "DOWNLOADING" as const },
      { state: "INGESTING" as const, stage: "archive_extraction" },
      { state: "INGESTING" as const, stage: "sid_enumeration" },
      { state: "INGESTING" as const, stage: "sid_metadata_parsing" },
    ];
    for (const input of working) {
      expect(statuses(input).filter((status) => status === "active")).toHaveLength(1);
    }
  });

  it("never shows a later step finished before an earlier one", () => {
    // The property the percentage could not hold: no going backwards, and no contradiction between
    // stages. Everything before the running step is done, everything after it is not.
    const timeline: Parameters<typeof hvscStageSteps>[0][] = [
      { state: "NOT_PRESENT" },
      { state: "DOWNLOADING", stage: "download" },
      { state: "DOWNLOADED" },
      { state: "INGESTING", stage: "archive_validation" },
      { state: "INGESTING", stage: "archive_extraction" },
      { state: "INGESTING", stage: "sid_enumeration" },
      { state: "INGESTING", stage: "songlengths" },
      { state: "INGESTING", stage: "sid_metadata_parsing" },
      { state: "READY" },
    ];
    const doneCounts = timeline.map((input) => statuses(input).filter((status) => status === "done").length);
    for (let i = 1; i < doneCounts.length; i += 1) {
      expect(doneCounts[i]).toBeGreaterThanOrEqual(doneCounts[i - 1]);
    }
    for (const input of timeline) {
      const list = statuses(input);
      const lastDone = list.lastIndexOf("done");
      const firstNotDone = list.findIndex((status) => status !== "done");
      if (lastDone >= 0 && firstNotDone >= 0) expect(lastDone).toBeLessThan(firstNotDone);
    }
  });

  it("shows every step finished once the library is reachable, and only then", () => {
    // The bar's worst failure was never displaying its completion at all. Here the finished state is
    // the resting state, so it cannot be missed.
    expect(statuses({ state: "READY" })).toEqual(["done", "done", "done", "done"]);
    expect(statuses({ state: "INGESTING", stage: "sid_metadata_parsing" })).not.toContain("pending");
    expect(statuses({ state: "INGESTING", stage: "sid_metadata_parsing" })).toContain("active");
  });

  it("counts the download finished as soon as ingestion begins, whatever stage is reported", () => {
    expect(statuses({ state: "INGESTING", stage: null })[0]).toBe("done");
    expect(idOf({ state: "INGESTING", stage: null })).toBe("unpack");
  });

  it("does not let an unrecognised stage drag the display backwards", () => {
    // A stage the mapping has not seen must not be read as "back to unpacking" once ingestion is well
    // under way, nor as an excuse to show nothing.
    expect(statuses({ state: "INGESTING", stage: "something_new" })[0]).toBe("done");
    expect(statuses({ state: "INGESTING", stage: "something_new" }).filter((s) => s === "active")).toHaveLength(1);
  });

  it("keeps the archive step finished while the archive sits cached", () => {
    expect(statuses({ state: "DOWNLOADED" })).toEqual(["done", "pending", "pending", "pending"]);
  });

  it("shows where a failure happened, with the earlier steps still credited", () => {
    expect(statuses({ state: "ERROR", stage: "sid_metadata_parsing" })).toEqual(["done", "done", "done", "failed"]);
    expect(statuses({ state: "ERROR", stage: "download" })).toEqual(["failed", "pending", "pending", "pending"]);
    // With only the coarse phase to go on, credit the download and blame the earliest ingest step
    // rather than overstating how far it got.
    expect(statuses({ state: "ERROR", failedPhase: "ingest" })).toEqual(["done", "failed", "pending", "pending"]);
    expect(statuses({ state: "ERROR", failedPhase: "download" })).toEqual(["failed", "pending", "pending", "pending"]);
  });

  it("groups the runtime's stage vocabulary onto the four the user sees", () => {
    const grouped: Record<string, HvscStageId | null> = {
      download: "download",
      archive_validation: "unpack",
      archive_extraction: "unpack",
      sid_enumeration: "scan",
      songlengths: "details",
      sid_metadata_parsing: "details",
      // The hydration pass reports under its own name. Observed unmapped on the device: the stepper
      // showed "Unpack" running for minutes while the panel below read "HVSC META 128/61,157".
      sid_metadata_hydration: "details",
      database_insertion: "details",
      unknown_stage: null,
    };
    for (const [stage, expected] of Object.entries(grouped)) {
      expect(stepForStage(stage)).toBe(expected);
    }
    expect(stepForStage(null)).toBeNull();
  });

  it("keeps the running step's own percentage in range, and says so when there is none", () => {
    expect(activeStepPercent(42.4)).toBe(42);
    expect(activeStepPercent(-5)).toBe(0);
    expect(activeStepPercent(140)).toBe(100);
    expect(activeStepPercent(null)).toBeNull();
    expect(activeStepPercent(undefined)).toBeNull();
    expect(activeStepPercent(Number.NaN)).toBeNull();
  });

  it("takes a resolved step over the raw stage, for a restart with no live events", () => {
    // Reopening the app mid-install restores state from the persisted summary without replaying
    // progress events, so the raw stage is null. Observed on the device: "Unpack" shown as running
    // for minutes while the panel below read "HVSC META 128/61,157".
    expect(statuses({ state: "INGESTING", stage: null, step: "details" })).toEqual(["done", "done", "done", "active"]);
    expect(idOf({ state: "INGESTING", stage: "archive_extraction", step: "details" })).toBe("details");
  });

  it("puts the hydration pass on the song-details step", () => {
    expect(statuses({ state: "INGESTING", stage: "sid_metadata_hydration" })).toEqual([
      "done",
      "done",
      "done",
      "active",
    ]);
  });

  it("prefers counts to a percentage, which reads zero for the first six hundred of 61,157 songs", () => {
    expect(stageCountLabel(128, 61_157)).toBe("128 / 61,157");
    expect(activeStepPercent((128 / 61_157) * 100)).toBe(0);
  });

  it("has no count to show until both numbers are known", () => {
    expect(stageCountLabel(null, 61_157)).toBeNull();
    expect(stageCountLabel(128, null)).toBeNull();
    expect(stageCountLabel(128, 0)).toBeNull();
    // "1 / 1" is a placeholder, not a count — unpacking showed it on the device for a whole stage.
    expect(stageCountLabel(1, 1)).toBeNull();
    expect(stageCountLabel(0, 61_157)).toBe("0 / 61,157");
  });

  it("always describes all four steps", () => {
    for (const state of ["NOT_PRESENT", "DOWNLOADING", "DOWNLOADED", "INGESTING", "READY", "ERROR"] as const) {
      expect(hvscStageSteps({ state }).map((step) => step.id)).toEqual(HVSC_STAGE_ORDER);
    }
  });
});
