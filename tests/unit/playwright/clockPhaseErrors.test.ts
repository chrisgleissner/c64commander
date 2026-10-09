/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { clockPhaseErrors } from "../../../playwright/parity/playbackParityScenarios";

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
