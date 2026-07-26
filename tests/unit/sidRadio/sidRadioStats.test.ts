/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  SID_RADIO_STATS_TESTID,
  getSidRadioStats,
  readSidRadioStatsFromDom,
  recordAutoAdvance,
  recordEmitted,
  recordRefill,
  recordSkip,
  resetSidRadioStats,
  updateSidRadioStats,
} from "@/lib/sidRadio/sidRadioStats";

beforeEach(() => resetSidRadioStats());

describe("sidRadioStats", () => {
  it("mirrors the stats to a hidden DOM blob the HIL can read", () => {
    updateSidRadioStats({ stationActive: true, engineThreadIsMain: false, seedKind: "song", shuffleSeed: 42 });
    const element = document.querySelector(`[data-testid="${SID_RADIO_STATS_TESTID}"]`);
    expect(element).not.toBeNull();
    const parsed = readSidRadioStatsFromDom();
    expect(parsed).toMatchObject({ stationActive: true, engineThreadIsMain: false, seedKind: "song", shuffleSeed: 42 });
  });

  it("aggregates the main-thread refill max (§9.2 refillMainThreadMaxMs)", () => {
    recordRefill({ lastRefillMs: 30, mainThreadMs: 8, emitted: 5, lookahead: 10, firstCandidate: true });
    recordRefill({ lastRefillMs: 20, mainThreadMs: 12, emitted: 5, lookahead: 10 });
    recordRefill({ lastRefillMs: 25, mainThreadMs: 4, emitted: 3, lookahead: 10 });
    const s = getSidRadioStats();
    expect(s.refillMainThreadMaxMs).toBe(12);
    expect(s.candidatesEmitted).toBe(13);
    expect(s.firstCandidateMs).toBe(30);
    expect(s.lastRefillMs).toBe(25);
  });

  it("counts auto-advances and skips, keeping them out of the emitted sequence", () => {
    // The emitted sequence is the station's output (recordEmitted), not
    // playback's progress through it: a listener who skips does not change
    // what the engine chose, and the G11 replay compares the choice.
    recordEmitted(11);
    recordEmitted(7);
    recordAutoAdvance();
    recordAutoAdvance();
    recordSkip(340);
    const s = getSidRadioStats();
    expect(s.tracksAutoAdvanced).toBe(2);
    expect(s.emittedSequence).toEqual([11, 7]);
    expect(s.skips).toBe(1);
    expect(s.skipToLaunchMs).toBe(340);
  });

  it("resets all counters", () => {
    updateSidRadioStats({ tracksAutoAdvanced: 30, skips: 5 });
    resetSidRadioStats();
    expect(getSidRadioStats().tracksAutoAdvanced).toBe(0);
    expect(getSidRadioStats().skips).toBe(0);
  });
});
