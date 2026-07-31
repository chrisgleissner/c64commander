/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What the app says while a seek waits for the renderer.
 *
 * The rule these tests exist to hold is that the figure shown comes from the RENDER head and never
 * from the playhead. The playhead is frozen during the wait, so a progress figure derived from it
 * would sit at zero forever and tell the listener nothing — and a wait that says nothing is
 * indistinguishable from a fault, which is the entire defect this state was added to remove.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  ALMOST_READY_SECONDS,
  describePendingSeek,
  nextPoliteAnnouncement,
  pendingSeekEtaSeconds,
  pendingSeekProgress,
  PENDING_ANNOUNCEMENT_INTERVAL_MS,
  type PendingSeekState,
} from "@/lib/playback/pendingSeekStatus";
import { __resetRenderThroughput, measuredRenderRatio, recordRenderMeasurement } from "@/lib/playback/renderThroughput";

const TUNE_MS = 180_000;

const state = (overrides: Partial<PendingSeekState> = {}): PendingSeekState => ({
  targetSeconds: 60,
  renderedAtRequestSeconds: 20,
  audibleAtRequestSeconds: 12,
  generation: 3,
  trackInstanceId: 1,
  ...overrides,
});

describe("pending seek progress", () => {
  it("starts near zero, because the denominator is fixed when the target is accepted", () => {
    // Not "how far through the tune is the render head", which would already read 33% here and
    // would jump straight to a high number for a seek made late in a tune.
    expect(pendingSeekProgress(state(), 20)).toBe(0);
  });

  it("reaches one exactly when the target becomes seekable", () => {
    expect(pendingSeekProgress(state(), 60)).toBe(1);
    expect(pendingSeekProgress(state(), 75)).toBe(1);
  });

  it("increases monotonically for an unchanged target", () => {
    const pending = state();
    const readings = [20, 25, 30, 44, 51, 60].map((rendered) => pendingSeekProgress(pending, rendered));
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i]).toBeGreaterThanOrEqual(readings[i - 1]);
    }
    expect(readings.at(-1)).toBe(1);
  });

  it("is not derived from the audible playhead", () => {
    // The playhead is frozen while waiting, so two states that differ ONLY in where playback was
    // left must report the same progress. If this ever fails, the figure has been wired to the
    // wrong signal.
    const early = state({ audibleAtRequestSeconds: 0 });
    const late = state({ audibleAtRequestSeconds: 59 });
    expect(pendingSeekProgress(early, 40)).toBe(pendingSeekProgress(late, 40));
  });

  it("resets when a new target supersedes the old one", () => {
    // The new record carries the render head as it stands NOW, so the figure starts again rather
    // than inheriting the previous target's progress.
    const first = state({ targetSeconds: 60, renderedAtRequestSeconds: 20 });
    expect(pendingSeekProgress(first, 50)).toBeCloseTo(0.75, 5);
    const second = state({ targetSeconds: 120, renderedAtRequestSeconds: 50, generation: 4 });
    expect(pendingSeekProgress(second, 50)).toBe(0);
  });

  it("treats a target already inside coverage as complete rather than dividing by zero", () => {
    expect(pendingSeekProgress(state({ targetSeconds: 20, renderedAtRequestSeconds: 20 }), 20)).toBe(1);
  });
});

describe("pending seek estimate", () => {
  it("divides the span still to render by the measured render rate", () => {
    expect(pendingSeekEtaSeconds(state(), 40, 5)).toBeCloseTo(4, 5);
  });

  it("has no answer before the render rate has been measured", () => {
    expect(pendingSeekEtaSeconds(state(), 40, null)).toBeNull();
  });

  it("refuses rates that cannot produce a duration", () => {
    expect(pendingSeekEtaSeconds(state(), 40, 0)).toBeNull();
    expect(pendingSeekEtaSeconds(state(), 40, -2)).toBeNull();
    expect(pendingSeekEtaSeconds(state(), 40, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("pending seek status text", () => {
  beforeEach(() => {
    __resetRenderThroughput();
    localStorage.clear();
  });

  it("names the position, the percentage and the estimate", () => {
    const described = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 18.36,
      durationMs: TUNE_MS,
      ratio: 2,
    });
    expect(described?.statusText).toBe("Preparing audio for 0:27 · 68% · about 4 s");
  });

  it("degrades to the percentage when there is no valid estimate", () => {
    const described = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 18.36,
      durationMs: TUNE_MS,
      ratio: null,
    });
    expect(described?.statusText).toBe("Preparing audio for 0:27 · 68%");
    expect(described?.etaSeconds).toBeNull();
  });

  it("stops counting down under a second and says so instead", () => {
    const described = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 26.5,
      durationMs: TUNE_MS,
      ratio: 2,
    });
    expect(described?.etaSeconds).toBeLessThan(ALMOST_READY_SECONDS + 1);
    expect(described?.almostReady).toBe(true);
    expect(described?.statusText).toBe("Almost ready to continue at 0:27");
  });

  it("quotes whole seconds only", () => {
    const described = describePendingSeek({
      state: state({ targetSeconds: 90, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 41.37,
      durationMs: TUNE_MS,
      ratio: 3.1,
    });
    expect(described?.statusText).toMatch(/about \d+ s$/);
    expect(described?.statusText).not.toMatch(/\d\.\d/);
  });

  it("takes its rate from the one smoothed estimator, and drops the estimate when that is reset", () => {
    // Reading the estimator here rather than passing a number is the point: a second rate tracker
    // for the UI would drift away from the one that sizes the startup buffer.
    expect(measuredRenderRatio()).toBeNull();
    const withoutEvidence = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 10,
      durationMs: TUNE_MS,
    });
    expect(withoutEvidence?.etaSeconds).toBeNull();

    recordRenderMeasurement(4, 1000);
    const withEvidence = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 10,
      durationMs: TUNE_MS,
    });
    expect(withEvidence?.etaSeconds).not.toBeNull();

    __resetRenderThroughput();
    const afterReset = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 10,
      durationMs: TUNE_MS,
    });
    expect(afterReset?.etaSeconds).toBeNull();
  });

  it("keeps the target out of the audible position it reports", () => {
    const described = describePendingSeek({
      state: state({ targetSeconds: 60, audibleAtRequestSeconds: 12 }),
      renderedSeconds: 30,
      durationMs: TUNE_MS,
      ratio: 2,
    });
    // The clock freezes at what was heard, never at what was asked for.
    expect(described?.audibleMs).toBe(12_000);
    expect(described?.targetPercent).toBeCloseTo(33.33, 1);
  });

  it("says nothing at all when the tune has no length to measure against", () => {
    expect(describePendingSeek({ state: state(), renderedSeconds: 30, durationMs: 0, ratio: 2 })).toBeNull();
  });
});

describe("pending seek announcement", () => {
  it("reads as a sentence rather than as the visible shorthand", () => {
    const described = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 18.36,
      durationMs: TUNE_MS,
      ratio: 2,
    });
    expect(described?.liveText).toBe(
      "Rendering audio for position 27 seconds. 68 percent ready. About 4 seconds remaining.",
    );
  });

  it("drops the estimate from the sentence when there is none", () => {
    const described = describePendingSeek({
      state: state({ targetSeconds: 27, renderedAtRequestSeconds: 0 }),
      renderedSeconds: 18.36,
      durationMs: TUNE_MS,
      ratio: null,
    });
    expect(described?.liveText).toBe("Rendering audio for position 27 seconds. 68 percent ready.");
  });

  it("holds a changed message until the interval is up", () => {
    const first = nextPoliteAnnouncement(null, "one", 1000);
    expect(first).toEqual({ text: "one", atMs: 1000 });
    // Too soon: the reader is still working through the first one.
    expect(nextPoliteAnnouncement(first, "two", 1500)).toBe(first);
    expect(nextPoliteAnnouncement(first, "two", 1000 + PENDING_ANNOUNCEMENT_INTERVAL_MS)).toEqual({
      text: "two",
      atMs: 1000 + PENDING_ANNOUNCEMENT_INTERVAL_MS,
    });
  });

  it("clears immediately, so a wait that has ended stops being announced", () => {
    const first = nextPoliteAnnouncement(null, "one", 1000);
    expect(nextPoliteAnnouncement(first, null, 1001)).toBeNull();
  });

  it("keeps an unchanged message identical, so nothing re-announces on every poll", () => {
    const first = nextPoliteAnnouncement(null, "one", 1000);
    expect(nextPoliteAnnouncement(first, "one", 99_000)).toBe(first);
  });
});
