/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureClockTick } from "@/lib/playback/remoteSeek/sidPlayerClock";

/** A clock that turns a second at `tickEveryMs`, offset by `phaseMs`, read with `roundTripMs` per read. */
const clock = (phaseMs: number, roundTripMs = 10, overrides: Record<number, number | null> = {}) => {
  let reads = 0;
  return async () => {
    reads += 1;
    await new Promise((resolve) => setTimeout(resolve, roundTripMs / 2));
    const seconds = Math.floor((Date.now() - phaseMs) / 1000);
    await new Promise((resolve) => setTimeout(resolve, roundTripMs / 2));
    return reads in overrides ? overrides[reads] : seconds;
  };
};

const run = async <T>(promise: Promise<T>) => {
  let result: T | undefined;
  let done = false;
  void promise.then((value) => {
    result = value;
    done = true;
  });
  for (let waited = 0; !done && waited < 5000; waited += 5) await vi.advanceTimersByTimeAsync(5);
  return result;
};

describe("measureClockTick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("places the tick between the two reads that saw it, within half a read period", async () => {
    // The clock turns at ...1_000_420, ...1_001_420 and so on.
    const tick = await run(measureClockTick(clock(420)));
    expect(tick?.clockSeconds).toBe(Math.floor((1_000_420 - 420) / 1000));
    expect(Math.abs((tick?.tickAtMs ?? 0) - 1_000_420)).toBeLessThanOrEqual(15);
  });

  it("skips a read that caught the digits mid-update, which steps back", async () => {
    const tick = await run(measureClockTick(clock(420, 10, { 3: 940 })));
    expect(Math.abs((tick?.tickAtMs ?? 0) - 1_000_420)).toBeLessThanOrEqual(15);
  });

  it("waits for the next tick when a slow read made the clock jump by more than a second", async () => {
    let reads = 0;
    const slowSecondRead = async () => {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, reads === 2 ? 1500 : 10));
      return Math.floor((Date.now() - 420) / 1000);
    };
    const tick = await run(measureClockTick(slowSecondRead));
    // Not between the first read and the slow one, which are a second and a half apart.
    expect((tick?.tickAtMs ?? 0) % 1000).toBeGreaterThanOrEqual(405);
    expect((tick?.tickAtMs ?? 0) % 1000).toBeLessThanOrEqual(435);
  });

  it("gives up on a clock that does not tick, as when the machine is paused", async () => {
    expect(await run(measureClockTick(async () => 42))).toBeNull();
  });

  it("gives up on a clock that cannot be read", async () => {
    expect(await run(measureClockTick(async () => null))).toBeNull();
  });

  it("stops at once when the caller no longer wants the answer", async () => {
    const read = vi.fn(async () => 42);
    expect(await run(measureClockTick(read, () => false))).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
