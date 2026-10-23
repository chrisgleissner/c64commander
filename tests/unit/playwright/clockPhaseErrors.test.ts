/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  CLOCK_PHASE_LIMIT_MS,
  clockPhaseErrors,
  judgeClockPhase,
  clockPhaseBySecond,
} from "../../../playwright/parity/playbackParityScenarios";

const ticks = (startMs: number, firstSecond: number, count: number, offsetMs = 0) =>
  Array.from({ length: count }, (_, index) => ({
    atMs: startMs + index * 1000 + offsetMs,
    seconds: firstSecond + index,
  }));

describe("clockPhaseErrors", () => {
  it("gives how much later the other clock turned to the same second", () => {
    const device = ticks(10_000, 40, 4);
    const page = ticks(10_000, 40, 4, 30);
    expect(clockPhaseErrors(device, page, [[0, 20_000]])).toEqual([30, 30, 30, 30]);
    expect(clockPhaseErrors(page, device, [[0, 20_000]])).toEqual([-30, -30, -30, -30]);
  });

  it("only judges changes inside the windows", () => {
    const device = ticks(10_000, 40, 6);
    const page = ticks(10_000, 40, 6, 20);
    expect(clockPhaseErrors(device, page, [[11_500, 13_500]])).toEqual([20, 20]);
  });

  it("reports NaN for a second the other clock skipped or showed more than 1.5 s away", () => {
    const device = ticks(10_000, 40, 3);
    const page = [
      { atMs: 10_010, seconds: 40 },
      { atMs: 12_010, seconds: 42 },
    ];
    expect(clockPhaseErrors(device, page, [[0, 20_000]])).toEqual([10, Number.NaN, 10]);
    expect(clockPhaseErrors([{ atMs: 10_000, seconds: 40 }], [{ atMs: 11_600, seconds: 40 }], [[0, 20_000]])).toEqual([
      Number.NaN,
    ]);
  });

  it("matches the nearest showing of a second that came round again after a rewind", () => {
    const device = [
      { atMs: 10_000, seconds: 40 },
      { atMs: 30_000, seconds: 40 },
    ];
    const page = [
      { atMs: 10_050, seconds: 40 },
      { atMs: 29_980, seconds: 40 },
    ];
    expect(clockPhaseErrors(device, page, [[0, 40_000]])).toEqual([50, -20]);
  });
});

describe("a steady window judged per second", () => {
  const LATE_PER_SIX = 1;
  const verdict = (lagsMs: number[], deviceTicks = lagsMs.length) => {
    const device = ticks(10_000, 40, deviceTicks);
    const page = lagsMs.map((lag, index) => ({ atMs: 10_000 + index * 1000 + lag, seconds: 40 + index }));
    const perSecond = clockPhaseBySecond(device, page, [[0, 60_000]]);
    return judgeClockPhase(perSecond, CLOCK_PHASE_LIMIT_MS, LATE_PER_SIX);
  };

  it("passes a clean window and one second paused by a loaded runner", () => {
    expect(verdict([17, 19, 17, 19, 17, 19])).toBeNull();
    expect(verdict([17, 19, 225, 19, 17, 19])).toBeNull();
  });

  it("counts a late second once, not once per clock", () => {
    const device = ticks(10_000, 40, 6);
    const page = ticks(10_000, 40, 6, 20).map((tick, index) =>
      index === 2 ? { ...tick, atMs: tick.atMs + 205 } : tick,
    );
    expect(clockPhaseBySecond(device, page, [[0, 60_000]])).toHaveLength(6);
  });

  it("fails every second late by a steady offset", () => {
    expect(verdict([200, 202, 205, 208, 210, 214])).not.toBeNull();
  });

  it("fails a window cut to four seconds, however late they are", () => {
    expect(verdict([600, 20, 600, 20])).toMatch(/only 4 seconds/);
  });

  it("fails a clock that drifts by a tenth of a second per second", () => {
    expect(verdict([-250, -150, -50, 50, 150, 250])).not.toBeNull();
  });

  it("fails a page second read from a 300 ms poll", () => {
    expect(verdict([10, 140, 270, 100, 230, 60])).not.toBeNull();
  });

  it("fails two seconds 900 ms late", () => {
    expect(verdict([20, 900, 20, 900, 20, 20])).not.toBeNull();
  });

  it("fails a page clock that stopped, so a second never showed", () => {
    const device = ticks(10_000, 40, 6);
    const page = ticks(10_000, 40, 3, 20);
    expect(
      judgeClockPhase(clockPhaseBySecond(device, page, [[0, 60_000]]), CLOCK_PHASE_LIMIT_MS, LATE_PER_SIX),
    ).toMatch(/one clock and not on the other/);
  });

  it("allows no late second when the driver allows none", () => {
    expect(judgeClockPhase([20, 20, 225, 20, 20, 20], CLOCK_PHASE_LIMIT_MS, 0)).not.toBeNull();
  });
});
