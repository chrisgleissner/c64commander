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
 * about 10-16x at 1 MHz, 40-57x at 4 MHz, 125-190x at 16 MHz and 295-430x at 64 MHz on a C64
 * Ultimate, and 10-19x, 54-97x, 210-352x and 391-638x at 1, 4, 16 and 48 MHz on an Ultimate 64 Elite.
 */

/**
 * One step per second held, each measured to fast forward clearly faster than the one before: 4 MHz
 * is 3-6x the 1 MHz rate, and each doubling after it 1.7-2.1x. 2 MHz is left out: it ran 0.76-1.33x
 * the 1 MHz rate on both machines.
 */
export const CPU_SPEED_RAMP_MHZ = [4, 8, 16, 32] as const;
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
 * machine already runs at, then always the machine's maximum (64 MHz on a C64 Ultimate, 48 on an
 * Ultimate 64), even where it adds little: 48 MHz on an Ultimate 64 Elite ran 1.04-1.05x the 32 MHz rate.
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
 * The least a CPU Speed multiplies the 1 MHz fast forward rate, from eight tunes measured on a C64
 * Ultimate (six from HVSC, a tone test tune and a play-call counter). The most it can multiply it
 * by is the clock ratio itself: the loop cannot outrun the CPU. Absolute rates cannot be tabulated,
 * because a light play routine fast forwards up to six times faster than real music at every speed.
 */
const RATE_RATIO_LOWER: ReadonlyArray<[number, number]> = [
  [1, 1],
  [2, 0.75],
  [4, 3],
  [8, 5.7],
  [16, 9],
  [32, 15.8],
  [64, 21],
];

const lowerRatio = (mhz: number): number => {
  if (mhz <= RATE_RATIO_LOWER[0][0]) return RATE_RATIO_LOWER[0][1];
  for (let index = 1; index < RATE_RATIO_LOWER.length; index += 1) {
    const [highMhz, highRatio] = RATE_RATIO_LOWER[index];
    if (mhz <= highMhz) {
      const [lowMhz, lowRatio] = RATE_RATIO_LOWER[index - 1];
      return lowRatio + ((highRatio - lowRatio) * (mhz - lowMhz)) / (highMhz - lowMhz);
    }
  }
  return RATE_RATIO_LOWER[RATE_RATIO_LOWER.length - 1][1];
};

/**
 * The fastest the player can possibly fast forward, in clock seconds a second per MHz: its loop
 * spends at least about 100 cycles on each play call, so 1 MHz runs at most 10000 calls a second.
 */
export const FASTEST_FAST_FORWARD_PER_MHZ = 200;
export const PULSE_MARGIN_SECONDS = 0.05;
/** A pulse aims at this share of what is left, so a rate slightly underestimated still stops short. */
export const PULSE_SHARE = 0.8;
export const MIN_PULSE_MS = 20;
/** Long enough to cover distance at the slowest speed, short enough to stay quick to cancel. */
export const MAX_PULSE_MS = 2000;
/** The clock shows whole seconds, so a pulse shorter than this many of them cannot be measured. */
export const MIN_PULSE_CLOCK_SECONDS = 1.5;

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
 * Every other speed's rate is then bounded from above: by the clock ratio from a slower measurement,
 * and by the least measured ratio from a faster one. A speed is used while the remaining distance
 * exceeds what it covers, at that bound, in the lead time, so a jump slows down early rather than
 * overshoots. A measurement never lowers the bound: the first CPU Speed change after a tune starts
 * can take a second to apply, and a rate measured meanwhile is far too low. The tiers are the
 * maximum, 4 MHz and the slowest speed: each change costs a CPU Speed write that may wait out the
 * config write interval, so they are few.
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
    // The slowest speed lands most precisely, so it is the last tier even when the user runs the
    // machine faster: the user's own speed is written back when the jump gives the device back.
    const tiers = [speeds[speeds.length - 1], 4, speeds[0]]
      .map((mhz) => (mhz === undefined ? null : optionForMhz(options, mhz)))
      .filter((option): option is string => option !== null);
    this.tiers = tiers.length ? [...new Set(tiers)] : [baseOption];
  }

  /** The speed a jump finishes at, and the only one whose landing is timed rather than read. */
  get finalOption(): string {
    return this.tiers[this.tiers.length - 1];
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

  /** The highest rate this option can have, given everything measured so far. */
  rateBound(option: string): number | null {
    const mhz = cpuSpeedMhz(option) ?? 1;
    let bound: number | null = null;
    for (const [measuredOption, rate] of this.measured) {
      const measuredMhz = cpuSpeedMhz(measuredOption) ?? 1;
      // rate(o) = rate(s) * R(o) / R(s) with R between the lower ratio and the clock ratio.
      const scale = measuredOption === option ? 1 : mhz / lowerRatio(measuredMhz);
      const scaled = rate * RATE_SAFETY_FACTOR * scale;
      bound = bound === null ? scaled : Math.max(bound, scaled);
    }
    return bound;
  }

  /** The fastest tier that cannot overshoot `remainingClockSeconds` within the lead time. */
  choose(remainingClockSeconds: number, readPeriodSeconds: number): string {
    if (!this.calibrated) return this.baseOption;
    const leadSeconds = 2 * readPeriodSeconds + RELEASE_MARGIN_SECONDS;
    for (let index = this.slowestChosen; index < this.tiers.length; index += 1) {
      const option = this.tiers[index];
      const rate = this.rateBound(option);
      if (rate !== null && remainingClockSeconds >= rate * leadSeconds) {
        this.slowestChosen = index;
        return option;
      }
    }
    this.slowestChosen = this.tiers.length - 1;
    return this.finalOption;
  }
}

/** The clock the CIA timers count, the cycles in a frame, and the exact frame rate they make. */
/**
 * `frameHz` is the frame rate the machine runs; `clockFrameHz` the one the SID player's clock counts at, which
 * is corrected only for the standard PAL or NTSC clock and so differs slightly in the other modes.
 */
export type MachineTiming = { frameHz: number; ciaClockHz: number; frameCycles: number; clockFrameHz: number };

const PAL_FRAME_CYCLES = 312 * 63;
const NTSC_FRAME_CYCLES = 263 * 65;
const SIXTY_HZ_SYSTEM_MODES = new Set(["NTSC", "PAL-60", "PAL-60/L"]);

/**
 * The CPU clock of each System Mode, from its PLL constant in the firmware's software/u64/color_timings.cc,
 * which is proportional to the clock (PAL 81247 for 985248 Hz). The /L modes run up to 0.17% faster than
 * their standard, 11 seconds an hour.
 */
const SYSTEM_MODE_CLOCK_HZ: Record<string, number> = Object.fromEntries(
  (
    [
      ["PAL", 81247],
      ["NTSC", 84338],
      ["PAL-60", 84372],
      ["NTSC-50", 81300],
      ["PAL-60/L", 84422],
      ["NTSC-50/L", 81385],
    ] as const
  ).map(([mode, pll]) => [mode, mode === "NTSC" ? 1022727 : Math.round((985248 * pll) / 81247)]),
);

const timing = (ciaClockHz: number, frameCycles: number): MachineTiming => ({
  frameHz: ciaClockHz / frameCycles,
  ciaClockHz,
  frameCycles,
  clockFrameHz: frameCycles === NTSC_FRAME_CYCLES ? 1022727 / NTSC_FRAME_CYCLES : 985248 / PAL_FRAME_CYCLES,
});

export const PAL_FRAME_LINES = 312;
export const NTSC_FRAME_LINES = 263;

/**
 * Timing of the machine, with PAL's 50.1245 Hz rather than 50: from the lines in a frame it really
 * runs when they are known, otherwise from its System Mode, anything unknown being PAL. An Ultimate
 * 64's SID player switches the machine to the tune's standard, so its System Mode can be the other one.
 */
export const machineTimingFor = (
  systemMode: string | null | undefined,
  frameLines: number | null = null,
): MachineTiming => {
  const mode = (systemMode ?? "").trim().toUpperCase();
  const modeSixtyHz = SIXTY_HZ_SYSTEM_MODES.has(mode);
  const sixtyHz = frameLines !== null ? frameLines === NTSC_FRAME_LINES : modeSixtyHz;
  // The mode's own clock while the machine runs its standard; the standard's while the player switched it.
  const modeClock = sixtyHz === modeSixtyHz ? SYSTEM_MODE_CLOCK_HZ[mode] : undefined;
  return sixtyHz ? timing(modeClock ?? 1022727, NTSC_FRAME_CYCLES) : timing(modeClock ?? 985248, PAL_FRAME_CYCLES);
};

export const isSixtyHzMachine = (machine: MachineTiming) => machine.frameCycles === NTSC_FRAME_CYCLES;

/**
 * The tune's play-call rate from CIA 1 timer A samples (little-endian pairs read at $DC04).
 *
 * A sample can only fall short of the latch, so the highest one is snapped up, within 10% (and down
 * by at most 0.5%, for a latch rounded the other way), to the nearest period a composer writes: a PAL or NTSC frame divided by one to eight. The rate is the
 * machine's CIA clock over that period. It is not a multiple of 50 or 60 on the other standard's
 * clock: a PAL tune's twice-a-frame latch plays 104 times a second on an NTSC machine.
 */
export const playCallRateFromTimerSamples = (samples: readonly number[], machine: MachineTiming): number | null => {
  const highest = Math.max(0, ...samples);
  if (highest <= 0) return null;
  const sampled = highest + 1;
  const composed = [PAL_FRAME_CYCLES, NTSC_FRAME_CYCLES]
    .flatMap((frame) => [1, 2, 3, 4, 5, 6, 7, 8].map((perFrame) => Math.round(frame / perFrame)))
    .filter((period) => period >= sampled * 0.995 && period <= sampled * 1.1);
  return machine.ciaClockHz / (composed.length ? Math.min(...composed) : sampled);
};

/**
 * Clock seconds that pass per tune second while fast forwarding.
 *
 * The player's clock counts frames at normal speed, but while fast forwarding it counts play calls
 * as frames. An NTSC tune on a PAL machine (60 calls a second) therefore gains 1.2 clock seconds per
 * tune second, and a 4x multi-speed tune 4. Measured against a play-call counter on the C64 Ultimate.
 */
export const clockSecondsPerTuneSecond = (playCallHz: number, timing: MachineTiming): number =>
  playCallHz / timing.clockFrameHz;
