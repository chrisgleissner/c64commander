/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionModel } from "@/lib/playback/remoteSeek/remoteSeekPositionModel";

/** A 4x multi-speed tune: four clock seconds pass per tune second while the key is down. */
const MULTI_SPEED = 4;
/** The current player's "mm:ss" rolls over after 99:59. */
const WRAP = 6000;

describe("remote seek position model", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const readAfter = (model: PositionModel, ms: number, clock: number, keyHeld: boolean) => {
    vi.advanceTimersByTime(ms);
    return model.advance(clock, keyHeld);
  };

  it("divides held clock seconds by the clock rate and counts released ones as they are", () => {
    const model = new PositionModel(10, 100, MULTI_SPEED, WRAP);
    expect(readAfter(model, 250, 140, true)).toBe(20);
    expect(readAfter(model, 1000, 141, false)).toBe(21);
  });

  it("counts a held clock that wrapped at 99:59", () => {
    const model = new PositionModel(0, 5990, MULTI_SPEED, WRAP);
    expect(readAfter(model, 250, 30, true)).toBe(10);
  });

  it("counts a long held gap that ran at normal speed as normal play when no rate was seen yet", () => {
    const model = new PositionModel(0, 0, MULTI_SPEED, WRAP);
    expect(readAfter(model, 8000, 8, true)).toBe(8);
  });

  it("splits a long held gap into fast forward and normal play by the rate seen just before", () => {
    const model = new PositionModel(0, 0, MULTI_SPEED, WRAP);
    // 40 clock seconds a second: the rate the key gave while the reads were close together.
    expect(readAfter(model, 250, 10, true)).toBe(2.5);
    // Two seconds held at that rate, then six of normal play before the restore released the key.
    expect(readAfter(model, 8000, 10 + 80 + 6, true)).toBeCloseTo(2.5 + 80 / MULTI_SPEED + 6, 5);
  });

  it("counts a long gap at the rate seen before as fast forward throughout", () => {
    const model = new PositionModel(0, 0, MULTI_SPEED, WRAP);
    readAfter(model, 250, 10, true);
    expect(readAfter(model, 2000, 10 + 80, true)).toBeCloseTo(2.5 + 80 / MULTI_SPEED, 5);
  });

  it("starts again from zero when the clock goes back at normal speed, short of rolling over", () => {
    const model = new PositionModel(30, 30, MULTI_SPEED, WRAP);
    expect(readAfter(model, 1000, 31, false)).toBe(31);
    // Something else restarted the tune, e.g. a key on the C64 itself.
    expect(readAfter(model, 1000, 1, false)).toBe(1);
  });

  it("rolls over at normal speed when the clock was about to", () => {
    const model = new PositionModel(5999, 5999, MULTI_SPEED, WRAP);
    expect(readAfter(model, 1000, 0, false)).toBe(6000);
  });

  it("rolls over at the wrap of a clock that shows hours", () => {
    const model = new PositionModel(0, 359_990, MULTI_SPEED, 360_000);
    expect(readAfter(model, 250, 30, true)).toBe(10);
  });

  it("treats a rate no faster than normal play as no rate seen", () => {
    const model = new PositionModel(0, 0, MULTI_SPEED, WRAP);
    readAfter(model, 300, 0, true);
    expect(readAfter(model, 3000, 3, true)).toBe(3);
  });
});
