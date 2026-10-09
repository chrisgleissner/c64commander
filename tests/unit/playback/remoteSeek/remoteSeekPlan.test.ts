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
  JumpSpeedPlanner,
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

  it("jumps through the maximum, 4 MHz and the slowest speed, whatever speed the machine runs at", () => {
    expect(new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1").tiers).toEqual(["64", " 4", " 1"]);
    expect(new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 8").tiers).toEqual(["64", " 4", " 1"]);
    expect(new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 8").finalOption).toBe(" 1");
  });

  it("stays at the machine's own speed until it has measured how fast this tune fast forwards", () => {
    const planner = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    expect(planner.choose(1000, 0.05)).toBe(" 1");
    planner.record(" 1", 10);
    expect(planner.choose(1000, 0.05)).toBe("64");
  });

  it("bounds a faster speed by the clock ratio from a measured one, so it slows down early", () => {
    const planner = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    planner.record(" 1", 10);
    expect(planner.rateBound("64")).toBeCloseTo(832);
    expect(planner.rateBound(" 4")).toBeCloseTo(52);
    // 832 x (2 x 0.05 + 0.05) = 125 clock seconds is the least the maximum is used for.
    expect(planner.choose(200, 0.05)).toBe("64");
    expect(planner.choose(100, 0.05)).toBe(" 4");
    expect(planner.choose(5, 0.05)).toBe(" 1");
  });

  it("bounds a slower speed from a faster measurement by the least measured ratio", () => {
    const planner = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    planner.record("64", 300);
    expect(planner.rateBound(" 4")).toBeCloseTo((300 * 1.3 * 4) / 21);
  });

  it("scales the lead with the read period, and a light tune's higher rate with it", () => {
    const slowReads = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    slowReads.record(" 1", 65);
    expect(slowReads.choose(600, 0.05)).toBe(" 4");
    const fastReads = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    fastReads.record(" 1", 65);
    expect(fastReads.choose(600, 0.02)).toBe("64");
  });

  it("never climbs back to a faster speed once it has slowed down", () => {
    const planner = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    planner.record(" 1", 10);
    expect(planner.choose(5, 0.05)).toBe(" 1");
    expect(planner.choose(1000, 0.05)).toBe(" 1");
  });

  it("never lowers a bound with a measurement, which a CPU Speed change still being applied makes too low", () => {
    const planner = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    planner.record(" 1", 10);
    planner.record("64", 89);
    expect(planner.rateBound("64")).toBeCloseTo(832);
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

describe("remote seek plan edges", () => {
  it("has no ramp and no jump tiers on a machine whose CPU Speed options are not speeds", () => {
    expect(fastForwardRampOptions(["Off"], 1)).toEqual([]);
    expect(new JumpSpeedPlanner(["Off"], "Off").tiers).toEqual(["Off"]);
  });

  it("bounds an 80 MHz speed by the clock ratio and the 64 MHz floor ratio", () => {
    const planner = new JumpSpeedPlanner([" 1", "80"], " 1");
    planner.record("80", 400);
    expect(planner.rateBound(" 1")).toBeCloseTo((400 * 1.3 * 1) / 21);
    expect(planner.tiers).toEqual(["80", " 1"]);
  });

  it("ignores a rate that is not positive", () => {
    const planner = new JumpSpeedPlanner(C64U_CPU_SPEEDS, " 1");
    planner.record(" 1", 0);
    expect(planner.calibrated).toBe(false);
    expect(planner.rateBound("64")).toBeNull();
  });

  it("leaves a rate below 50 Hz as measured", () => {
    expect(snapPlayCallRate(30)).toBe(30);
  });
});

describe("remote seek errors", () => {
  it("describes errors that are not Error objects", async () => {
    const { remoteSeekErrorDetails } = await import("@/lib/playback/remoteSeek/remoteSeekErrors");
    expect(remoteSeekErrorDetails("timeout")).toEqual({ error: "timeout", stack: undefined });
  });
});
