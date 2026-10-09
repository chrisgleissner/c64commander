/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  clockSecondsPerTuneSecond,
  cpuSpeedMhz,
  fastForwardRampOptions,
  machineTimingFor,
  optionForMhz,
  playCallRateFromTimerSamples,
  rewindOffsetSeconds,
  seekSpeedFor,
  seekSpeedTiers,
  snapPlayCallRate,
} from "@/lib/playback/remoteSeek/remoteSeekPlan";
import {
  isSidPlayerTitle,
  parseSidPlayerClock,
  screenCodesToText,
  sidPlayerScreenAddress,
} from "@/lib/playback/remoteSeek/sidPlayerScreen";
import { C64U_CPU_SPEEDS } from "./fakeRemoteSeekDevice";

const U64_CPU_SPEEDS = [" 1", " 2", " 3", " 4", " 5", " 6", " 8", "10", "12", "14", "16", "20", "24", "32", "40", "48"];
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("remote seek plan", () => {
  it("reads CPU Speed options in the device's padded spelling", () => {
    expect(cpuSpeedMhz(" 4")).toBe(4);
    expect(cpuSpeedMhz("Manual")).toBeNull();
    expect(optionForMhz(C64U_CPU_SPEEDS, 4)).toBe(" 4");
    expect(optionForMhz(C64U_CPU_SPEEDS, 5)).toBeNull();
  });

  it("ramps a held fast forward through 2, 4, 8, 16 and 32 MHz to the machine's maximum", () => {
    expect(fastForwardRampOptions(C64U_CPU_SPEEDS, 1)).toEqual([" 2", " 4", " 8", "16", "32", "64"]);
    expect(fastForwardRampOptions(U64_CPU_SPEEDS, 1)).toEqual([" 2", " 4", " 8", "16", "32", "48"]);
  });

  it("starts the ramp above a CPU Speed the user already runs at, and never slows the machine down", () => {
    expect(fastForwardRampOptions(C64U_CPU_SPEEDS, 8)).toEqual(["16", "32", "64"]);
    expect(fastForwardRampOptions(C64U_CPU_SPEEDS, 64)).toEqual([]);
  });

  it("rewinds 10, 20, 40 and then 80 seconds for each further second held", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(rewindOffsetSeconds)).toEqual([0, 10, 30, 70, 150, 230, 310]);
  });

  it("jumps at the maximum, then 4 MHz, then the machine's own speed for the last seconds", () => {
    const tiers = seekSpeedTiers(C64U_CPU_SPEEDS, " 1");
    expect(tiers.map((tier) => tier.option)).toEqual(["64", " 4", " 1"]);
    expect(seekSpeedFor(tiers, 300)).toBe("64");
    expect(seekSpeedFor(tiers, 20)).toBe(" 4");
    expect(seekSpeedFor(tiers, 2)).toBe(" 1");
  });

  it("leaves out jump tiers that are not faster than the user's own CPU Speed", () => {
    expect(seekSpeedTiers(C64U_CPU_SPEEDS, " 8").map((tier) => tier.option)).toEqual(["64", " 8"]);
  });

  it("times PAL and 50 Hz modes at the PAL clock and the 60 Hz modes at the NTSC clock", () => {
    expect(machineTimingFor("PAL")).toEqual({ frameHz: 50, ciaClockHz: 985248 });
    expect(machineTimingFor("NTSC-50")).toEqual({ frameHz: 50, ciaClockHz: 985248 });
    expect(machineTimingFor("PAL-60")).toEqual({ frameHz: 60, ciaClockHz: 1022727 });
    expect(machineTimingFor(undefined).frameHz).toBe(50);
  });

  it("snaps the sampled play-call rate down to the multiple of 50 or 60 Hz it overshoots", () => {
    expect(snapPlayCallRate(52.7)).toBe(50);
    expect(snapPlayCallRate(61.1)).toBe(60);
    expect(snapPlayCallRate(202.4)).toBe(200);
    expect(snapPlayCallRate(75)).toBe(75);
  });

  it("derives the play-call rate from the largest CIA timer sample", () => {
    expect(playCallRateFromTimerSamples([100, 19000, 4000], 985248)).toBe(50);
    expect(playCallRateFromTimerSamples([], 985248)).toBeNull();
  });

  it("counts 1.2 clock seconds per tune second for an NTSC tune on a PAL machine, as measured", () => {
    expect(clockSecondsPerTuneSecond(60, machineTimingFor("PAL"))).toBeCloseTo(1.2);
    expect(clockSecondsPerTuneSecond(200, machineTimingFor("PAL"))).toBe(4);
  });
});

describe("SID player screen", () => {
  it("finds the screen from the VIC bank and matrix registers", () => {
    expect(sidPlayerScreenAddress(0x97, 0x25)).toBe(0x0800);
    expect(sidPlayerScreenAddress(0x95, 0x35)).toBe(0x8c00);
  });

  it("reads the clock the player draws", () => {
    expect(parseSidPlayerClock(ascii("01:05"))).toBe(65);
    expect(parseSidPlayerClock(new Uint8Array(5))).toBeNull();
    expect(parseSidPlayerClock(ascii("01:75"))).toBeNull();
  });

  it("recognises the player's title in screen codes", () => {
    const title = Uint8Array.from("*** THE C-64 ULTIMATE SID PLAYER ***", (char) =>
      /[A-Z]/.test(char) ? char.charCodeAt(0) - 64 : char.charCodeAt(0),
    );
    expect(screenCodesToText(title)).toBe("*** THE C-64 ULTIMATE SID PLAYER ***");
    expect(isSidPlayerTitle(title)).toBe(true);
    expect(isSidPlayerTitle(ascii("READY."))).toBe(false);
  });
});
