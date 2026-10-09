/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Playback parity: the same transport works the same way whether the tune plays on the phone or on
 * the C64 — play, pause, resume, stop, hold Next to fast forward, hold Previous to rewind, and a tap
 * on the progress bar to jump.
 *
 * The scenarios only talk to a `ParityDriver`, so one definition runs in two places: in CI against
 * the web build and the mock server (playwright/playbackParity.spec.ts), and on the bench against
 * the phone and a real Ultimate (tools/hil/playback_parity_hil.ts), where a microphone also hears
 * what the speaker plays.
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
  for (let waited = 0; waited < LANDING_TIMEOUT_MS; waited += 250) {
    const shown = await driver.shownSeconds();
    if (shown !== null) return shown;
    await driver.wait(250);
  }
  throw new ParityFailure(`no landing within ${LANDING_TIMEOUT_MS} ms`);
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

const expectMachineAsItWas = async (driver: ParityDriver, route: ParityRoute, what: string) => {
  const changed = await driver.machineLeftChanged(route);
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

/** The page turns each second within this long of the C64's clock turning it. */
export const CLOCK_PHASE_LIMIT_MS = 150;
/** After a landing the page re-reads the C64's clock and its phase; compared only once that is done. */
const CLOCK_SETTLE_MS = 3000;
const CLOCK_STEADY_MS = 6000;

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
      const windows: Array<[number, number]> = [];
      const steady = async () => {
        const from = Date.now() + CLOCK_SETTLE_MS;
        await driver.wait(CLOCK_SETTLE_MS + CLOCK_STEADY_MS);
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
      const names = ["playing", "after fast forward", "after a jump", "after a rewind"];
      windows.forEach((window, index) => {
        const pageLag = clockPhaseErrors(recording.device, recording.page, [window]);
        const errors = [...pageLag, ...clockPhaseErrors(recording.page, recording.device, [window])];
        const what = names[index];
        check(errors.length >= 8, `${what}: only ${errors.length} second changes were seen`);
        check(!errors.some(Number.isNaN), `${what}: a second showed on one clock and not on the other`);
        const worst = Math.max(...errors.map(Math.abs));
        const lags = pageLag.map(Math.round).sort((x, y) => x - y);
        driver.report?.(
          `${what}: the page turned each second ${lags.join(", ")} ms after the C64; at most ${worst} ms apart`,
        );
        check(worst <= CLOCK_PHASE_LIMIT_MS, `${what}: the page and the C64 turned a second ${worst} ms apart`);
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
