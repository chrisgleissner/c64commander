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
} from "@/lib/playback/remoteSeek/remoteSeekPlan";
import {
  findTimeFields,
  parseClockText,
  readClockFromRow,
  screenCodesToText,
  sidPlayerScreenAddress,
  tickingClockField,
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

  it("ramps a held fast forward through 4, 8, 16 and 32 MHz, skipping 2 MHz, which is no faster than 1", () => {
    expect(fastForwardRampOptions(C64U_CPU_SPEEDS, 1)).toEqual([" 4", " 8", "16", "32", "64"]);
  });

  it("always ends at the machine's maximum, however little it adds", () => {
    expect(fastForwardRampOptions(U64_CPU_SPEEDS, 1)).toEqual([" 4", " 8", "16", "32", "48"]);
    expect(fastForwardRampOptions(U64_CPU_SPEEDS, 40)).toEqual(["48"]);
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

  it("times each System Mode at its own clock and frame, PAL at 50.1245 Hz rather than 50", () => {
    // The clocks follow the PLL constants of u64/color_timings.cc; the 60 Hz modes run 263 lines of 65 cycles.
    const clocks: Record<string, [number, number]> = {
      PAL: [985248, 19656],
      "NTSC-50": [985891, 19656],
      "NTSC-50/L": [986921, 19656],
      NTSC: [1022727, 17095],
      "PAL-60": [1023144, 17095],
      "PAL-60/L": [1023750, 17095],
    };
    for (const [mode, [ciaClockHz, frameCycles]] of Object.entries(clocks)) {
      expect(machineTimingFor(mode)).toEqual({
        frameHz: ciaClockHz / frameCycles,
        ciaClockHz,
        frameCycles,
        // The player's clock counts at the standard rate, whatever the mode's own clock.
        clockFrameHz: frameCycles === 17095 ? 1022727 / 17095 : 985248 / 19656,
      });
    }
    expect(machineTimingFor(" pal-60/l ").ciaClockHz).toBe(1023750);
    expect(machineTimingFor(undefined).frameHz).toBeCloseTo(50.1245, 4);
  });

  it("times a machine its player switched to the other standard at that standard's clock", () => {
    expect(machineTimingFor("NTSC-50/L", 263)).toEqual(machineTimingFor("NTSC"));
    expect(machineTimingFor("PAL-60", 312)).toEqual(machineTimingFor("PAL"));
    expect(machineTimingFor("PAL-60/L", 263).ciaClockHz).toBe(1023750);
  });

  it("snaps the largest CIA timer sample up to the latch a composer writes, and times it at the machine's clock", () => {
    const pal = machineTimingFor("PAL");
    const ntsc = machineTimingFor("NTSC");
    expect(playCallRateFromTimerSamples([100, 19000, 4000], pal)).toBeCloseTo(pal.frameHz, 9);
    expect(playCallRateFromTimerSamples([9700], pal)).toBeCloseTo(985248 / 9828, 9);
    // The same PAL latch on an NTSC machine plays 104 times a second, not 100.
    expect(playCallRateFromTimerSamples([9700], ntsc)).toBeCloseTo(1022727 / 9828, 9);
    // An NTSC frame over four (4274) and 60 Hz over four on the NTSC clock (4261) are 0.3% apart; 100
    // timer samples fall about 1% short of the latch, so the two cannot be told apart.
    expect(Math.abs(playCallRateFromTimerSamples([4200], ntsc)! / (1022727 / 4274) - 1)).toBeLessThan(0.005);
    expect(playCallRateFromTimerSamples([], pal)).toBeNull();
  });

  it("times a tune's own 60 Hz latch on a PAL machine at 60 Hz, not at an NTSC frame's 57.6", () => {
    const pal = machineTimingFor("PAL");
    for (const sample of [16200, 16300, 16420]) {
      expect(Math.abs(playCallRateFromTimerSamples([sample], pal)! / 60 - 1)).toBeLessThan(0.005);
    }
  });

  it("leaves a latch no frame divides as sampled", () => {
    expect(playCallRateFromTimerSamples([32767], machineTimingFor("PAL"))).toBeCloseTo(985248 / 32768, 9);
  });

  it("counts 1.2 clock seconds per tune second for an NTSC tune on a PAL machine, as measured", () => {
    const pal = machineTimingFor("PAL");
    expect(clockSecondsPerTuneSecond(985248 / 16388, pal)).toBeCloseTo(1.1994, 4);
    expect(clockSecondsPerTuneSecond(pal.frameHz * 4, pal)).toBeCloseTo(4, 9);
  });
});

describe("SID player screen", () => {
  it("finds the screen from the VIC bank and matrix registers", () => {
    expect(sidPlayerScreenAddress(0x97, 0x25)).toBe(0x0800);
    expect(sidPlayerScreenAddress(0x95, 0x35)).toBe(0x8c00);
  });

  it("reads time fields with and without hours, and nothing else", () => {
    expect(parseClockText("01:05")).toBe(65);
    expect(parseClockText("1:05")).toBe(65);
    expect(parseClockText("99:59")).toBe(5999);
    expect(parseClockText("1:02:05")).toBe(3725);
    expect(parseClockText("1:75:05")).toBeNull();
    expect(parseClockText("01:75")).toBeNull();
    expect(parseClockText("     ")).toBeNull();
  });

  it("reads screen codes as text, reverse video included", () => {
    const title = Uint8Array.from("SID PLAYER 1:05", (char) =>
      /[A-Z]/.test(char) ? char.charCodeAt(0) - 64 : char.charCodeAt(0),
    );
    expect(screenCodesToText(title)).toBe("SID PLAYER 1:05");
    expect(screenCodesToText(title.map((code) => code | 0x80))).toBe("SID PLAYER 1:05");
  });

  it("finds every time field on a screen, row by row, without running one into the next row", () => {
    const screen = new Uint8Array(1000).fill(0x20);
    screen.set(ascii("LENGTH 03:00"), 21 * 40);
    screen.set(ascii("01:05"), 23 * 40);
    screen.set(ascii("12"), 38);
    screen.set(ascii(":34"), 40);
    expect(findTimeFields(screen, 0x0800)).toEqual([
      { screenAddress: 0x0800, rowAddress: 0x0800 + 21 * 40, column: 7, length: 5, wrapSeconds: 6000, seconds: 180 },
      { screenAddress: 0x0800, rowAddress: 0x0800 + 23 * 40, column: 0, length: 5, wrapSeconds: 6000, seconds: 65 },
    ]);
  });

  it("takes the field that moved forward as the clock, not one that stood still or ran backwards", () => {
    const row = (text: string) => findTimeFields(ascii(text.padEnd(40, " ")), 0x0800);
    const before = row("03:00  9:59  1:00:00  00:10");
    const after = row("03:00  10:00  0:59:59  00:10");
    expect(tickingClockField(before, after, 1.2)).toEqual({
      screenAddress: 0x0800,
      rowAddress: 0x0800,
      column: 7,
      length: 5,
      wrapSeconds: 6000,
    });
    expect(tickingClockField(row("00:10"), row("00:40"), 1.2)).toBeNull();
    expect(tickingClockField(row("03:00"), row("03:00"), 1.2)).toBeNull();
  });

  it("reads a clock back from its row as it grows and shrinks", () => {
    const clock = { screenAddress: 0x0800, rowAddress: 0x0b98, column: 0, length: 4, wrapSeconds: 6000 };
    expect(readClockFromRow(ascii("9:59"), clock)).toBe(599);
    expect(readClockFromRow(ascii("10:00  03:00"), clock)).toBe(600);
    expect(readClockFromRow(ascii("      03:00"), clock)).toBeNull();
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
});

describe("remote seek errors", () => {
  it("describes errors that are not Error objects", async () => {
    const { remoteSeekErrorDetails } = await import("@/lib/playback/remoteSeek/remoteSeekErrors");
    expect(remoteSeekErrorDetails("timeout")).toEqual({ error: "timeout", stack: undefined });
  });
});
