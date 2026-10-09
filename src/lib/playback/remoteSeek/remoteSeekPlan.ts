/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The numbers behind seeking a tune the C64 plays itself, measured with
 * `tools/hil/remote_sid_seek_poc.py` on a C64 Ultimate (firmware 1.2.1RC2).
 *
 * The Ultimate's SID player fast forwards while the left-arrow key is held, by calling the tune's
 * play routine back to back. That loop is bound by the CPU, so CPU Speed sets how fast it goes:
 * about 10-16x at 1 MHz, 40-57x at 4 MHz, 125-190x at 16 MHz and 295-430x at 64 MHz.
 */

export const CPU_SPEED_RAMP_MHZ = [2, 4, 8, 16, 32] as const;
export const REWIND_STEPS_SECONDS = [10, 20, 40, 80] as const;

/** The CPU Speed of an option string such as " 4" or "16", or null for anything else. */
export const cpuSpeedMhz = (option: string): number | null => {
  const trimmed = option.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
};

/** The device's own spelling of a speed. The firmware rejects "4" when its option is " 4". */
export const optionForMhz = (options: readonly string[], mhz: number): string | null =>
  options.find((option) => cpuSpeedMhz(option) === mhz) ?? null;

const numericSpeeds = (options: readonly string[]): number[] =>
  [...new Set(options.map(cpuSpeedMhz).filter((mhz): mhz is number => mhz !== null))].sort((a, b) => a - b);

/**
 * CPU Speeds for each further second Next is held: the ramp entries faster than the speed the
 * machine already runs at, then the machine's maximum (64 MHz on a C64 Ultimate, 48 on an Ultimate 64).
 */
export const fastForwardRampOptions = (options: readonly string[], startMhz: number): string[] => {
  const speeds = numericSpeeds(options);
  if (speeds.length === 0) return [];
  const steps: number[] = CPU_SPEED_RAMP_MHZ.filter((mhz) => mhz > startMhz && speeds.includes(mhz));
  const max = speeds[speeds.length - 1];
  if (max > startMhz && !steps.includes(max)) steps.push(max);
  return steps.map((mhz) => optionForMhz(options, mhz) as string);
};

/** How far back a rewind lands after `stepsHeld` steps: 10, 30, 70, 150, 230, ... seconds. */
export const rewindOffsetSeconds = (stepsHeld: number): number => {
  let total = 0;
  for (let step = 0; step < stepsHeld; step += 1) {
    total += REWIND_STEPS_SECONDS[Math.min(step, REWIND_STEPS_SECONDS.length - 1)];
  }
  return total;
};

/**
 * Fast forward rate at each CPU Speed relative to 1 MHz, as the fastest and the slowest of six tunes
 * measured it (C_mon, Commando, Cybernoid, Last Ninja, Wizball and a tone test tune). The ratios
 * hold across tunes far better than the rates do: a tune with a light play routine ran 6x faster
 * than real music at every speed, so absolute rates cannot be tabulated, while 64 MHz stayed 21-36x
 * the 1 MHz rate for every tune.
 */
const RATE_RATIO_UPPER: ReadonlyArray<[number, number]> = [
  [1, 1],
  [2, 1.6],
  [4, 4.8],
  [8, 9],
  [16, 16],
  [32, 25],
  [64, 38],
];
const RATE_RATIO_LOWER: ReadonlyArray<[number, number]> = [
  [1, 1],
  [2, 0.85],
  [4, 3],
  [8, 5.8],
  [16, 9.2],
  [32, 16],
  [64, 21],
];

const interpolateRatio = (table: ReadonlyArray<[number, number]>, mhz: number): number => {
  if (mhz <= table[0][0]) return table[0][1];
  for (let index = 1; index < table.length; index += 1) {
    const [highMhz, highRatio] = table[index];
    if (mhz <= highMhz) {
      const [lowMhz, lowRatio] = table[index - 1];
      return lowRatio + ((highRatio - lowRatio) * (mhz - lowMhz)) / (highMhz - lowMhz);
    }
  }
  return table[table.length - 1][1];
};

/** Rate measurements need this much fast forward behind them before they are trusted. */
export const RATE_WINDOW_SECONDS = 0.15;
/** Added to twice the clock read period: the key release and its arrival at the device. */
const RELEASE_MARGIN_SECONDS = 0.05;
/** A rate read off a whole-second clock over a few seconds can be a quarter low. */
const RATE_SAFETY_FACTOR = 1.3;

/**
 * Chooses the CPU Speed for each step of a jump.
 *
 * A jump starts at the machine's own speed and measures how fast this tune fast forwards there.
 * Every faster speed is then predicted from that measurement with the upper ratio, so a prediction
 * can only be too high, which makes the jump slow down early rather than overshoot. A speed is used
 * while the remaining distance exceeds what it covers in the lead time; measured rates replace the
 * predictions as the jump goes. The tiers are the maximum, 4 MHz and the machine's own speed: each
 * change costs a CPU Speed write that may wait out the config write interval, so they are few.
 */
export class JumpSpeedPlanner {
  readonly tiers: string[];
  private readonly measured = new Map<string, number>();
  /** Tiers are only ever left downwards: each change costs a write, and climbing back invited oscillation. */
  private slowestChosen = 0;

  constructor(
    options: readonly string[],
    readonly baseOption: string,
  ) {
    const speeds = numericSpeeds(options);
    const baseMhz = cpuSpeedMhz(baseOption) ?? 1;
    const faster = [speeds[speeds.length - 1], 4]
      .filter((mhz): mhz is number => mhz !== undefined && mhz > baseMhz)
      .map((mhz) => optionForMhz(options, mhz))
      .filter((option): option is string => option !== null);
    this.tiers = [...new Set(faster), baseOption];
  }

  get calibrated(): boolean {
    return this.measured.size > 0;
  }

  record(option: string, clockSecondsPerSecond: number) {
    if (clockSecondsPerSecond > 0) this.measured.set(option, clockSecondsPerSecond);
  }

  measuredRate(option: string): number | null {
    return this.measured.get(option) ?? null;
  }

  /** The highest rate this option can plausibly have, given what has been measured. */
  predictedRate(option: string): number | null {
    const own = this.measured.get(option);
    if (own !== undefined) return own;
    const mhz = cpuSpeedMhz(option) ?? 1;
    let highest: number | null = null;
    for (const [measuredOption, rate] of this.measured) {
      const measuredMhz = cpuSpeedMhz(measuredOption) ?? 1;
      const scaled = (rate * interpolateRatio(RATE_RATIO_UPPER, mhz)) / interpolateRatio(RATE_RATIO_LOWER, measuredMhz);
      highest = highest === null ? scaled : Math.max(highest, scaled);
    }
    return highest;
  }

  /** The fastest tier that cannot overshoot `remainingClockSeconds` within the lead time. */
  choose(remainingClockSeconds: number, readPeriodSeconds: number): string {
    if (!this.calibrated) return this.baseOption;
    const leadSeconds = 2 * readPeriodSeconds + RELEASE_MARGIN_SECONDS;
    for (let index = this.slowestChosen; index < this.tiers.length; index += 1) {
      const option = this.tiers[index];
      const rate = this.predictedRate(option);
      if (rate !== null && remainingClockSeconds >= rate * RATE_SAFETY_FACTOR * leadSeconds) {
        this.slowestChosen = index;
        return option;
      }
    }
    this.slowestChosen = this.tiers.length - 1;
    return this.baseOption;
  }
}

export type MachineTiming = { frameHz: number; ciaClockHz: number };

const SIXTY_HZ_SYSTEM_MODES = new Set(["NTSC", "PAL-60", "PAL-60/L"]);

/** Frame rate and CIA clock of a System Mode; anything unknown is treated as PAL. */
export const machineTimingFor = (systemMode: string | null | undefined): MachineTiming =>
  SIXTY_HZ_SYSTEM_MODES.has((systemMode ?? "").trim().toUpperCase())
    ? { frameHz: 60, ciaClockHz: 1022727 }
    : { frameHz: 50, ciaClockHz: 985248 };

/**
 * Play calls per second, snapped down to a multiple of 50 or 60 Hz within 10%.
 *
 * The rate is measured from the largest sampled value of CIA 1 timer A, which can only fall short of
 * the latch, so the raw rate can only be high; the answer is the largest multiple at or below it.
 */
export const snapPlayCallRate = (rawHz: number): number => {
  const candidates = [50, 60].flatMap((base) => [1, 2, 3, 4, 5, 6, 7, 8].map((k) => base * k));
  const below = candidates.filter((candidate) => candidate <= rawHz * 1.02);
  if (below.length === 0) return rawHz;
  const best = Math.max(...below);
  return rawHz / best <= 1.1 ? best : rawHz;
};

/** The tune's play-call rate from CIA 1 timer A samples (little-endian pairs read at $DC04). */
export const playCallRateFromTimerSamples = (samples: readonly number[], ciaClockHz: number): number | null => {
  const highest = Math.max(0, ...samples);
  return highest > 0 ? snapPlayCallRate(ciaClockHz / (highest + 1)) : null;
};

/**
 * Clock seconds that pass per tune second while fast forwarding.
 *
 * The player's clock counts frames at normal speed, but while fast forwarding it counts play calls
 * as frames. An NTSC tune on a PAL machine (60 calls a second) therefore gains 1.2 clock seconds per
 * tune second, and a 4x multi-speed tune 4. Measured against a play-call counter on the C64 Ultimate.
 */
export const clockSecondsPerTuneSecond = (playCallHz: number, timing: MachineTiming): number =>
  playCallHz / timing.frameHz;
