/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOCK_PHASE_LIMIT_MS,
  clockPhaseErrors,
  judgeClockPhase,
  clockPhaseBySecond,
  clockWentBackwards,
  PARITY_SCENARIOS,
  type ParityDriver,
} from "../../../playwright/parity/playbackParityScenarios";

describe("clock sampling after a seek", () => {
  afterEach(() => vi.useRealTimers());

  const scenario = () => PARITY_SCENARIOS.find((entry) => entry.name.startsWith("shows the C64's own second"))!;

  it("starts its steady measurement only after a delayed device-clock read has reached the page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sampledAt: number[] = [];
    const measurementStarted = new Error("measurement started");
    const driver = {
      followsDeviceClock: async () => Date.now() >= 7200,
      recordClocks: async (during: () => Promise<void>) => during(),
      wait: async (ms: number) => {
        if (ms >= 10_000) {
          sampledAt.push(Date.now());
          throw measurementStarted;
        }
        vi.setSystemTime(Date.now() + ms);
      },
    } as unknown as ParityDriver;
    await expect(scenario().run(driver, "c64")).rejects.toBe(measurementStarted);
    expect(sampledAt).toEqual([7200]);
  });

  it("fails without sampling when the page never follows the device clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const waits: number[] = [];
    const driver = {
      followsDeviceClock: async () => false,
      recordClocks: async (during: () => Promise<void>) => during(),
      wait: async (ms: number) => {
        waits.push(ms);
        if (ms >= 10_000) throw new Error("attempted steady measurement before clock synchronization");
        vi.setSystemTime(Date.now() + ms);
      },
    } as unknown as ParityDriver;
    await expect(scenario().run(driver, "c64")).rejects.toThrow("the page did not re-read the C64's clock");
    expect(waits).not.toContain(10_000);
  });
});

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
  const LATE_PER_FIVE = 1;
  const verdict = (lagsMs: number[], latePerFive = LATE_PER_FIVE) => {
    const device = ticks(10_000, 40, lagsMs.length);
    const page = lagsMs.map((lag, index) => ({ atMs: 10_000 + index * 1000 + lag, seconds: 40 + index }));
    return judgeClockPhase(clockPhaseBySecond(device, page, [[0, 60_000]]), CLOCK_PHASE_LIMIT_MS, latePerFive);
  };
  const clean = [17, 19, 17, 19, 17, 19, 17, 19, 17, 19];
  const withLate = (late: Record<number, number>) => clean.map((lag, index) => late[index] ?? lag);

  it("passes a clean window and the loaded-runner shape of two moderately late seconds in ten", () => {
    expect(verdict(clean)).toBeNull();
    expect(verdict(withLate({ 3: 223, 7: 225 }))).toBeNull();
  });

  it("counts a late second once, not once per clock", () => {
    const device = ticks(10_000, 40, 10);
    const page = ticks(10_000, 40, 10, 20).map((tick, index) =>
      index === 2 ? { ...tick, atMs: tick.atMs + 205 } : tick,
    );
    expect(clockPhaseBySecond(device, page, [[0, 60_000]])).toHaveLength(10);
  });

  it("fails three late seconds in ten", () => {
    expect(verdict(withLate({ 1: 223, 4: 225, 8: 230 }))).toMatch(/3 of 10 seconds/);
  });

  it("fails every second late by a steady offset", () => {
    expect(verdict([200, 202, 205, 208, 210, 214, 200, 202, 205, 208])).not.toBeNull();
  });

  it("fails a window shorter than eight seconds, however late they are", () => {
    expect(verdict([600, 20, 600, 20])).toMatch(/only 4 seconds/);
    expect(verdict([20, 19, 20, 19, 20, 19])).toMatch(/only 6 seconds/);
  });

  it("fails a clock that drifts by a tenth of a second per second", () => {
    expect(verdict([-250, -200, -150, -100, -50, 0, 50, 100, 150, 200])).not.toBeNull();
  });

  it("fails a page second read from a 300 ms poll", () => {
    expect(verdict([10, 140, 270, 100, 230, 60, 190, 290, 40, 160])).not.toBeNull();
  });

  it("fails any second later than half a second, however few", () => {
    expect(verdict(withLate({ 5: 600 }))).toMatch(/more than 500 ms/);
    expect(verdict(withLate({ 5: 1400 }))).toMatch(/more than 500 ms/);
    expect(verdict(withLate({ 2: 900, 6: 900 }))).toMatch(/more than 500 ms/);
  });

  it("fails a page clock that stopped, so a second never showed", () => {
    const device = ticks(10_000, 40, 10);
    const page = ticks(10_000, 40, 6, 20);
    expect(
      judgeClockPhase(clockPhaseBySecond(device, page, [[0, 60_000]]), CLOCK_PHASE_LIMIT_MS, LATE_PER_FIVE),
    ).toMatch(/one clock and not on the other/);
  });

  it("allows no late second when the allowance is zero or not a number", () => {
    expect(verdict(withLate({ 4: 225 }), 0)).not.toBeNull();
    expect(verdict(withLate({ 4: 225 }), Number.NaN)).not.toBeNull();
    expect(verdict(withLate({ 4: 225 }), -1)).not.toBeNull();
  });

  it("sees a clock that steps backwards, which has the right seconds in the wrong order", () => {
    const stepped = [40, 41, 42, 41, 42, 43].map((seconds, index) => ({ atMs: 10_000 + index * 1000, seconds }));
    expect(clockWentBackwards(stepped, [[0, 60_000]])).toBe(true);
    expect(clockWentBackwards(ticks(10_000, 40, 8), [[0, 60_000]])).toBe(false);
  });
});
