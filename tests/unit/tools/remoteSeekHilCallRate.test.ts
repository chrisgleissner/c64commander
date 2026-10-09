/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { snapCallHz, SYSTEM_MODE_CPU_HZ, type CounterTune } from "../../../tools/hil/remoteSeekHil/tunes";

const tune = (ciaTimer: number | null = null): CounterTune => ({
  name: "counter",
  video: "PAL",
  busyLoops: 0,
  ciaTimer,
});

describe("SYSTEM_MODE_CPU_HZ", () => {
  it("derives every mode's CPU clock from the PAL and NTSC clocks the firmware's PLL constants stand for", () => {
    expect(SYSTEM_MODE_CPU_HZ.PAL).toBe(985248);
    expect(Math.abs(SYSTEM_MODE_CPU_HZ.NTSC - 1022727)).toBeLessThan(10);
    expect(SYSTEM_MODE_CPU_HZ["PAL-60/L"]).toBeGreaterThan(SYSTEM_MODE_CPU_HZ["PAL-60"]);
    expect(SYSTEM_MODE_CPU_HZ["NTSC-50/L"]).toBeGreaterThan(SYSTEM_MODE_CPU_HZ["NTSC-50"]);
  });
});

describe("snapCallHz", () => {
  it("takes a PAL frame tune's rate as 50.1245 Hz, not the nominal 50", () => {
    expect(snapCallHz(50.11, "PAL", tune())).toBeCloseTo(985248 / 19656, 6);
  });

  it("uses the clock of the mode the machine runs in", () => {
    expect(snapCallHz(59.86, "PAL-60", tune())).toBeCloseTo(SYSTEM_MODE_CPU_HZ["PAL-60"] / 17095, 6);
    expect(snapCallHz(59.88, "PAL-60/L", tune())).toBeCloseTo(SYSTEM_MODE_CPU_HZ["PAL-60/L"] / 17095, 6);
  });

  it("knows the NTSC-on-PAL period and a tune's own CIA latch", () => {
    expect(snapCallHz(60.1, "PAL", tune())).toBeCloseTo(985248 / 16388, 6);
    expect(snapCallHz(100.2, "PAL", tune(0x2663))).toBeCloseTo(985248 / 0x2664, 6);
  });

  it("refuses a rate that matches nothing rather than grade against a guess", () => {
    expect(() => snapCallHz(55, "PAL", tune())).toThrow(/no known rate/);
    expect(() => snapCallHz(50, "SECAM", tune())).toThrow(/no CPU clock/);
  });
});
