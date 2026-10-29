/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Playback parity: play, pause, resume, stop, hold Next or Previous, and tap the bar work alike on the phone and the
 * C64. Scenarios only talk to a `ParityDriver`, so they run in CI on the mock (playwright/playbackParity.spec.ts) and
 * on the bench with a microphone (tools/hil/playback_parity_hil.ts).
 */

export type ParityRoute = "phone" | "c64";

/** Whether a steady tone was heard, window by window, while a step ran. */
export type SoundTrace = { windowMs: number; present: boolean[]; startedAt: number };

/** The moment a clock started showing `seconds`, in host milliseconds. */
export type ClockTransition = { atMs: number; seconds: number };
/** Every change of the second shown on the page and on the C64's own clock, on one time base. */
export type ClockRecording = { page: ClockTransition[]; device: ClockTransition[] };

export type ParityDriver = {
  readonly label: string;
  /** Start the parity tune on `route` from the Play page, and wait until seeking is offered. */
  startTune(route: ParityRoute): Promise<void>;
  tap(testId: string): Promise<void>;
  hold(testId: string, ms: number): Promise<void>;
  /** Tap the progress bar at `fraction` of its width. */
  tapBar(fraction: number): Promise<void>;
  /** The elapsed time the page shows, or null while it shows where a seek is heading instead. */
  shownSeconds(): Promise<number | null>;
  /**
   * How far the phone has rendered toward a seek's target, in percent, or null when no seek waits
   * for the render. While one waits nothing at the new position sounds yet.
   */
  renderWaitProgress?: () => Promise<number | null>;
  durationSeconds(): Promise<number>;
  /** "playing", "paused" or "stopped", as the transport shows it. */
  transportState(): Promise<"playing" | "paused" | "stopped">;
  /** Where the tune really is, when the driver can tell without the page; null where it cannot. */
  truthSeconds(route: ParityRoute): Promise<number | null>;
  /** Anything a seek left changed on the machine: CPU Speed, Vol Master, a held key, a journal. */
  machineLeftChanged(route: ParityRoute): Promise<string[]>;
  /** Record what the speaker plays while `during` runs; absent where there is no microphone. */
  listen?: (during: () => Promise<void>) => Promise<SoundTrace>;
  /** Where a scenario's measurements are worth keeping, e.g. a bench log. */
  report?: (line: string) => void;
  /** Record both clocks while `during` runs; absent where the C64's clock cannot be read. */
  recordClocks?: (during: () => Promise<void>) => Promise<ClockRecording>;
  /** Whether the page's elapsed time was last put on the C64's own clock tick, as it is once a landing is re-read. */
  followsDeviceClock(): Promise<boolean>;
  /** Of every five seconds in a steady window, how many may miss the limit: one on a shared CI runner, whose scheduler can pause either clock. */
  clockLateSecondsPerFive?: number;
  wait(ms: number): Promise<void>;
};

export type ParityScenario = {
  name: string;
  /** Only where the driver can listen. */
  needsMicrophone?: boolean;
  run(driver: ParityDriver, route: ParityRoute): Promise<void>;
};

export class ParityFailure extends Error {}

const check = (condition: boolean, message: string) => {
  if (!condition) throw new ParityFailure(message);
};

/** Seeks land within this much of their target, on either route. */
const LANDING_TOLERANCE_SECONDS = 4;
const LANDING_TIMEOUT_MS = 30_000;
/**
 * A seek waiting for the phone's render may take longer than a landing, as long as the render keeps
 * moving: the slowest renderer reached 1:29 of a tune from a cold start in 31 s on a Pixel 4.
 */
const RENDER_WAIT_LIMIT_MS = 180_000;
const RENDER_STALL_MS = 15_000;

/**
 * After a gesture: wait for the seek to show (a target instead of a position) or for the position to
 * move away from `from`, then for the landing. Reading at once can still see the old position.
 */
export const settledAfterSeek = async (driver: ParityDriver, from: number): Promise<number> => {
  for (let waited = 0; waited < 8000; waited += 200) {
    const shown = await driver.shownSeconds();
    if (shown === null || Math.abs(shown - from) > 3) break;
    await driver.wait(200);
  }
  return landedSeconds(driver);
};

/** Poll the transport for `state`, which a C64 reaches only after its mute and pause requests. */
const waitForTransport = async (driver: ParityDriver, state: "playing" | "paused" | "stopped") => {
  for (let waited = 0; waited < 8000; waited += 250) {
    if ((await driver.transportState()) === state) return;
    await driver.wait(250);
  }
  throw new ParityFailure(`the transport does not show ${state}`);
};

/** Wait until the page shows a position again rather than a seek target, and return it. */
export const landedSeconds = async (driver: ParityDriver): Promise<number> => {
  let sinceProgress = 0;
  let lastProgress: number | null = null;
  for (let waited = 0; waited < RENDER_WAIT_LIMIT_MS; waited += 250) {
    const shown = await driver.shownSeconds();
    if (shown !== null) return shown;
    const progress = (await driver.renderWaitProgress?.()) ?? null;
    sinceProgress = progress !== null && progress !== lastProgress ? 0 : sinceProgress + 250;
    lastProgress = progress;
    if (progress === null && waited >= LANDING_TIMEOUT_MS) break;
    if (progress !== null && sinceProgress >= RENDER_STALL_MS) {
      throw new ParityFailure(`the render toward the seek target stopped at ${progress}% for ${RENDER_STALL_MS} ms`);
    }
    await driver.wait(250);
  }
  throw new ParityFailure(
    lastProgress === null
      ? `no landing within ${LANDING_TIMEOUT_MS} ms`
      : `no landing within ${RENDER_WAIT_LIMIT_MS} ms of waiting for the render`,
  );
};

/** Wait while a seek waits for the phone's render, as long as that render is visibly moving. */
const waitOutRender = async (driver: ParityDriver) => {
  if ((await driver.renderWaitProgress?.()) != null) await landedSeconds(driver);
};

/** The page agrees with the tune, where the driver knows where the tune is. */
const expectShownMatchesTruth = async (driver: ParityDriver, route: ParityRoute, what: string) => {
  const truth = await driver.truthSeconds(route);
  const shown = await driver.shownSeconds();
  if (truth === null || shown === null) return;
  check(
    Math.abs(shown - truth) <= LANDING_TOLERANCE_SECONDS,
    `${what}: the page shows ${shown} s, the tune is at ${truth.toFixed(1)} s`,
  );
};

/** A landing shows before the restore's config writes and read-back, so the machine is given until the app is idle. */
const RESTORE_SETTLE_MS = 10_000;

const expectMachineAsItWas = async (driver: ParityDriver, route: ParityRoute, what: string) => {
  const deadline = Date.now() + RESTORE_SETTLE_MS;
  let changed = await driver.machineLeftChanged(route);
  while (changed.length > 0 && Date.now() < deadline) {
    await driver.wait(500);
    changed = await driver.machineLeftChanged(route);
  }
  check(changed.length === 0, `${what}: ${changed.join("; ")}`);
};

/** Fraction of `trace` windows between `fromMs` and `toMs` after it started in which the tone sounded. */
export const presence = (trace: SoundTrace, fromMs: number, toMs: number): number => {
  const first = Math.max(0, Math.floor(fromMs / trace.windowMs));
  const last = Math.min(trace.present.length, Math.ceil(toMs / trace.windowMs));
  if (last <= first) return 0;
  return trace.present.slice(first, last).filter(Boolean).length / (last - first);
};

/**
 * For each change of `from` inside one of `windows`, how many milliseconds later `to` turned to the
 * same second (negative: earlier), or NaN when `to` did not show that second within 1.5 s of it.
 */
export const clockPhaseErrors = (
  from: ClockTransition[],
  to: ClockTransition[],
  windows: Array<[number, number]>,
): number[] =>
  from
    .filter(({ atMs }) => windows.some(([start, end]) => atMs >= start && atMs <= end))
    .map(({ atMs, seconds }) => {
      const offsets = to.filter((t) => t.seconds === seconds).map((t) => t.atMs - atMs);
      const nearest = offsets.reduce((best, offset) => (Math.abs(offset) < Math.abs(best) ? offset : best), Infinity);
      return Math.abs(nearest) <= 1500 ? nearest : Number.NaN;
    });

/**
 * The worst phase error of each second that changed inside the windows: the larger of what each clock saw of
 * the other, NaN when either clock did not show that second. One entry per second, so a late second counts once.
 */
export const clockPhaseBySecond = (
  device: ClockTransition[],
  page: ClockTransition[],
  windows: Array<[number, number]>,
): number[] => {
  const worst = new Map<number, number>();
  const note = (seconds: number[], errors: number[]) =>
    errors.forEach((error, index) => {
      const previous = worst.get(seconds[index]);
      const magnitude = Math.abs(error);
      worst.set(
        seconds[index],
        previous === undefined || Number.isNaN(magnitude) ? magnitude : Math.max(previous, magnitude),
      );
    });
  const inWindows = (ticks: ClockTransition[]) =>
    ticks.filter(({ atMs }) => windows.some(([start, end]) => atMs >= start && atMs <= end));
  note(
    inWindows(device).map((t) => t.seconds),
    clockPhaseErrors(device, page, windows),
  );
  note(
    inWindows(page).map((t) => t.seconds),
    clockPhaseErrors(page, device, windows),
  );
  return [...worst.values()];
};

/** Seconds a steady window must show to be judged; a 10 s window shows ten, so shorter ones are not judged at all. */
export const MIN_CLOCK_SECONDS = 8;

/** A second this late is a fault however loaded the runner was. */
export const CLOCK_HARD_LIMIT_MS = 500;

/** Whether a clock showed a second that did not follow the one before it, as when it steps backwards. */
export const clockWentBackwards = (ticks: ClockTransition[], windows: Array<[number, number]>): boolean => {
  const inWindows = ticks
    .filter(({ atMs }) => windows.some(([start, end]) => atMs >= start && atMs <= end))
    .sort((x, y) => x.atMs - y.atMs);
  return inWindows.some((tick, index) => index > 0 && tick.seconds !== inWindows[index - 1].seconds + 1);
};

/**
 * Why a steady window fails, or null. Judged per second: at most `latePerFive` of every five seconds may miss
 * the limit (a loaded runner can pause either clock for a moment), none may be later than the hard limit, and a
 * second missing on one clock fails. A steady offset, a drift, a page clock fed by a coarse poll and a stuck
 * clock show in many seconds. A rate that is not a finite number allows none.
 */
export const judgeClockPhase = (perSecond: number[], limit: number, latePerFive: number): string | null => {
  if (perSecond.length < MIN_CLOCK_SECONDS) return `only ${perSecond.length} seconds were seen`;
  if (perSecond.some(Number.isNaN)) return "a second showed on one clock and not on the other";
  const hard = perSecond.filter((error) => error > CLOCK_HARD_LIMIT_MS);
  if (hard.length > 0)
    return `${hard.length} seconds were more than ${CLOCK_HARD_LIMIT_MS} ms apart: ${perSecond.map(Math.round).join(", ")}`;
  const rate = Number.isFinite(latePerFive) && latePerFive > 0 ? latePerFive : 0;
  const allowed = Math.floor((perSecond.length * rate) / 5);
  const late = perSecond.filter((error) => error > limit).length;
  return late > allowed
    ? `${late} of ${perSecond.length} seconds were more than ${limit} ms apart (${allowed} allowed): ${perSecond.map(Math.round).join(", ")}`
    : null;
};

/** The page turns each second within this long of the C64's clock turning it. */
export const CLOCK_PHASE_LIMIT_MS = 150;
const CLOCK_STEADY_MS = 10_000;
/**
 * The page re-reads the C64's clock after a landing, once the device is given back. On a loaded core that
 * took up to 7.2 s from the landing, so a steady window starts when it is done, not a fixed time after it.
 */
const CLOCK_FOLLOW_LIMIT_MS = 15_000;

const waitForClockFollow = async (driver: ParityDriver, what: string) => {
  const deadline = Date.now() + CLOCK_FOLLOW_LIMIT_MS;
  while (!(await driver.followsDeviceClock())) {
    if (Date.now() >= deadline) {
      throw new ParityFailure(`${what}: the page did not re-read the C64's clock within ${CLOCK_FOLLOW_LIMIT_MS} ms`);
    }
    await driver.wait(100);
  }
};

const jumpTo = async (driver: ParityDriver, route: ParityRoute, fraction: number, what: string) => {
  const target = fraction * (await driver.durationSeconds());
  const from = await landedSeconds(driver);
  await driver.tapBar(fraction);
  const landed = await settledAfterSeek(driver, from);
  check(
    Math.abs(landed - target) <= LANDING_TOLERANCE_SECONDS,
    `${what}: landed at ${landed} s, aimed at ${target.toFixed(1)} s`,
  );
  await expectShownMatchesTruth(driver, route, what);
  await expectMachineAsItWas(driver, route, what);
};

export const PARITY_SCENARIOS: ParityScenario[] = [
  {
    name: "plays, and the elapsed time advances",
    async run(driver) {
      await driver.wait(3000);
      const first = await landedSeconds(driver);
      await driver.wait(2000);
      const second = await landedSeconds(driver);
      check(second >= first + 1, `elapsed went from ${first} s to ${second} s in 2 s`);
      check((await driver.transportState()) === "playing", "the transport does not show playing");
    },
  },
  {
    name: "pauses, holds its place, and resumes from there",
    async run(driver, route) {
      await driver.tap("playlist-pause");
      await waitForTransport(driver, "paused");
      await driver.wait(500);
      const pausedAt = await landedSeconds(driver);
      await driver.wait(2500);
      const stillAt = await landedSeconds(driver);
      check(Math.abs(stillAt - pausedAt) <= 1, `paused at ${pausedAt} s but moved to ${stillAt} s`);
      await driver.tap("playlist-pause");
      await waitForTransport(driver, "playing");
      await driver.wait(3000);
      const resumedAt = await landedSeconds(driver);
      check(resumedAt >= stillAt + 1 && resumedAt <= stillAt + 6, `resumed from ${stillAt} s to ${resumedAt} s`);
      await expectShownMatchesTruth(driver, route, "after resume");
    },
  },
  {
    name: "fast forwards while Next is held",
    async run(driver, route) {
      const before = await landedSeconds(driver);
      // Short enough to stay inside a short tune: winding past its end ends it, on both routes.
      await driver.hold("playlist-next", 1500);
      const landed = await settledAfterSeek(driver, before);
      check(landed >= before + 4, `held Next for 1.5 s and went from ${before} s to ${landed} s`);
      check((await driver.transportState()) === "playing", "a held Next stopped playback or changed the tune");
      await expectShownMatchesTruth(driver, route, "after the hold");
      await expectMachineAsItWas(driver, route, "after the hold");
    },
  },
  {
    name: "jumps to where the progress bar is tapped, forward and back",
    async run(driver, route) {
      await jumpTo(driver, route, 0.6, "forward to 60%");
      await jumpTo(driver, route, 0.15, "back to 15%");
    },
  },
  {
    name: "rewinds while Previous is held",
    async run(driver, route) {
      await jumpTo(driver, route, 0.5, "to 50% first");
      const before = await landedSeconds(driver);
      await driver.hold("playlist-prev", 1200);
      const landed = await settledAfterSeek(driver, before);
      check(landed <= before - 3 && landed >= before - 35, `held Previous at ${before} s and landed at ${landed} s`);
      check((await driver.transportState()) === "playing", "a held Previous stopped playback or changed the tune");
      await expectShownMatchesTruth(driver, route, "after the rewind");
      await expectMachineAsItWas(driver, route, "after the rewind");
    },
  },
  {
    name: "is silent while it rewinds, and plays again once it lands",
    needsMicrophone: true,
    async run(driver, route) {
      await jumpTo(driver, route, 0.5, "to 50% first");
      let tappedAt = 0;
      let landedAt = 0;
      // On the phone a jump far into a tune waits for the render to reach it, silently, as designed.
      await waitOutRender(driver);
      const trace = await driver.listen!(async () => {
        await driver.wait(1500);
        tappedAt = Date.now();
        const from = await landedSeconds(driver);
        await driver.tapBar(0.1);
        await settledAfterSeek(driver, from);
        landedAt = Date.now();
        await driver.wait(3000);
      });
      const before = presence(trace, 0, tappedAt - trace.startedAt - 200);
      const during = presence(trace, tappedAt - trace.startedAt + 400, landedAt - trace.startedAt - 400);
      const after = presence(trace, landedAt - trace.startedAt + 1000, landedAt - trace.startedAt + 3000);
      check(before >= 0.8, `the tone was heard in only ${(before * 100).toFixed(0)}% of the time before the rewind`);
      check(during <= 0.1, `the tone was heard in ${(during * 100).toFixed(0)}% of the rewind`);
      check(after >= 0.8, `the tone was heard in only ${(after * 100).toFixed(0)}% of the time after landing`);
    },
  },
  {
    name: "shows the C64's own second, also after fast forward, a jump and a rewind",
    async run(driver, route) {
      if (route !== "c64" || !driver.recordClocks) return;
      const names = ["playing", "after fast forward", "after a jump", "after a rewind"];
      const windows: Array<[number, number]> = [];
      const steady = async () => {
        await waitForClockFollow(driver, names[windows.length]);
        const from = Date.now();
        await driver.wait(CLOCK_STEADY_MS);
        windows.push([from, Date.now()]);
      };
      const seek = async (gesture: () => Promise<void>) => {
        const before = await landedSeconds(driver);
        await gesture();
        await settledAfterSeek(driver, before);
        await steady();
      };
      const recording = await driver.recordClocks(async () => {
        await steady();
        await seek(() => driver.hold("playlist-next", 1500));
        await seek(() => driver.tapBar(0.6));
        await seek(() => driver.tapBar(0.15));
      });
      await expectMachineAsItWas(driver, route, "after the clock checks");
      windows.forEach((window, index) => {
        const pageLag = clockPhaseErrors(recording.device, recording.page, [window]);
        const perSecond = clockPhaseBySecond(recording.device, recording.page, [window]);
        const what = names[index];
        const lags = pageLag.map(Math.round).sort((x, y) => x - y);
        driver.report?.(
          `${what}: the page turned each second ${lags.join(", ")} ms after the C64; at most ${Math.max(...perSecond)} ms apart`,
        );
        check(
          !clockWentBackwards(recording.device, [window]) && !clockWentBackwards(recording.page, [window]),
          `${what}: a clock showed a second that did not follow the one before it`,
        );
        const failure = judgeClockPhase(perSecond, CLOCK_PHASE_LIMIT_MS, driver.clockLateSecondsPerFive ?? 0);
        check(failure === null, `${what}: ${failure}`);
      });
    },
  },
  {
    name: "stops, and leaves the machine as it was",
    async run(driver, route) {
      await driver.tap("playlist-play");
      await waitForTransport(driver, "stopped");
      await expectMachineAsItWas(driver, route, "after stop");
    },
  },
];
