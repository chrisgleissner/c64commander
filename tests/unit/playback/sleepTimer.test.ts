/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  armTimed,
  describeSleepTimer,
  formatRemaining,
  hasElapsed,
  remainingMs,
  shouldStopAfterTune,
  SLEEP_TIMER_OFF,
} from "@/lib/playback/sleepTimer";

const NOW = 1_700_000_000_000;

describe("sleepTimer", () => {
  it("arms for the number of minutes asked for", () => {
    const mode = armTimed(30, NOW);
    expect(remainingMs(mode, NOW)).toBe(30 * 60_000);
    expect(hasElapsed(mode, NOW)).toBe(false);
  });

  it("elapses at its end, not before", () => {
    const mode = armTimed(15, NOW);
    expect(hasElapsed(mode, NOW + 15 * 60_000 - 1)).toBe(false);
    expect(hasElapsed(mode, NOW + 15 * 60_000)).toBe(true);
  });

  it("never elapses on the clock when it is waiting for the tune to end", () => {
    // This one fires on an event, not a time. A clock check that returned true for it would stop
    // playback mid-tune, which is the opposite of what was asked for.
    expect(hasElapsed({ kind: "after-tune" }, NOW + 10 * 60 * 60_000)).toBe(false);
    expect(shouldStopAfterTune({ kind: "after-tune" })).toBe(true);
    expect(shouldStopAfterTune(SLEEP_TIMER_OFF)).toBe(false);
    expect(shouldStopAfterTune(armTimed(30, NOW))).toBe(false);
  });

  it("never elapses when it is off", () => {
    expect(hasElapsed(SLEEP_TIMER_OFF, NOW + 1e9)).toBe(false);
    expect(remainingMs(SLEEP_TIMER_OFF, NOW)).toBeNull();
  });

  it("counts down in minutes and seconds, and in hours when there are hours", () => {
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(59_000)).toBe("0:59");
    expect(formatRemaining(90_000)).toBe("1:30");
    expect(formatRemaining(60 * 60_000)).toBe("1:00:00");
  });

  it("rounds the countdown up, so it does not sit on zero while music is still playing", () => {
    expect(formatRemaining(800)).toBe("0:01");
    expect(formatRemaining(1)).toBe("0:01");
  });

  it("always says what it is doing, so a stop is never a mystery", () => {
    expect(describeSleepTimer(SLEEP_TIMER_OFF, NOW)).toBe("Off");
    expect(describeSleepTimer({ kind: "after-tune" }, NOW)).toBe("After this tune");
    expect(describeSleepTimer(armTimed(45, NOW), NOW)).toBe("45:00 left");
    expect(describeSleepTimer(armTimed(45, NOW), NOW + 44 * 60_000)).toBe("1:00 left");
  });
});
