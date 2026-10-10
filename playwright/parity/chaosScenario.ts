/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Playback chaos: seeded random, often overlapping transport gestures (Pause mid-hold, a replaced jump, the app
 * backgrounded or killed while a key is held, output switched). Once idle: settings restored, no held key or seek
 * journal, the page shows the real position, the transport shows a state the action can lead to, no error logged.
 */

import { landedSeconds, ParityFailure, type ParityDriver, type ParityRoute } from "./playbackParityScenarios";

type TransportState = "playing" | "paused" | "stopped";

export type ChaosDriver = ParityDriver & {
  /** Put a finger down on `testId` (at `fraction` of its width) and keep it there. */
  pointerDown(testId: string, fraction?: number): Promise<void>;
  pointerUp(): Promise<void>;
  /** Error entries the app logged since `sinceMs`. */
  errorsSince(sinceMs: number): Promise<string[]>;
  /** True while Previous and Next fast forward and rewind rather than change the track. */
  seekingOffered(): Promise<boolean>;
  /** The app's own log of seeking since `sinceMs`, attached to a record that has violations. */
  diagnose?: (sinceMs: number) => Promise<string[]>;
  /** Send the app to the background for `ms`, or kill it, and bring it back on the Play page. */
  disrupt?: (kind: "background" | "kill", ms: number) => Promise<void>;
};

export type ChaosRecord = {
  step: number;
  action: string;
  route: ParityRoute;
  ms: number;
  violations: string[];
  log?: string[];
};

/** A press shorter than the app's hold threshold (450 ms) is a track change, not a seek. */
const MIN_HOLD_MS = 600;
/** Within this much of the tune, once idle; generous enough for a jump that is still settling. */
const POSITION_TOLERANCE_SECONDS = 4;
const IDLE_TIMEOUT_MS = 45_000;

const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Context = {
  driver: ChaosDriver;
  route: ParityRoute;
  random: () => number;
  between: (low: number, high: number) => number;
};

type Action = {
  name: string;
  weight: number;
  /** Runs the gesture and returns the states the transport may then show. */
  run(context: Context): Promise<TransportState[]>;
  /** Only where the driver can do it. */
  needs?: (driver: ChaosDriver) => boolean;
};

const hold = async ({ driver, between }: Context, testId: string, low: number, high: number) => {
  await driver.pointerDown(testId);
  await driver.wait(between(low, high));
  await driver.pointerUp();
};

/** Resume once the pause has landed: during a seek it first waits for the seek to give the machine back. */
const resumeIfPaused = async (driver: ChaosDriver) => {
  for (let waited = 0; waited < 8000 && (await driver.transportState()) !== "paused"; waited += 250) {
    await driver.wait(250);
  }
  if ((await driver.transportState()) === "paused") await driver.tap("playlist-pause");
};

export const CHAOS_ACTIONS: Action[] = [
  {
    name: "hold Next",
    weight: 4,
    // Holding past the end of the tune ends it.
    run: async (c) => (await hold(c, "playlist-next", MIN_HOLD_MS, 4000), ["playing", "stopped"]),
  },
  {
    name: "hold Previous",
    weight: 3,
    run: async (c) => (await hold(c, "playlist-prev", MIN_HOLD_MS, 3000), ["playing"]),
  },
  {
    name: "tap the bar",
    weight: 4,
    run: async (c) => (await c.driver.tapBar(c.between(0.02, 0.95)), ["playing"]),
  },
  {
    name: "tap the bar twice, the second before the first lands",
    weight: 2,
    run: async (c) => {
      await c.driver.tapBar(c.between(0.3, 0.95));
      await c.driver.wait(c.between(150, 1200));
      await c.driver.tapBar(c.between(0.02, 0.6));
      return ["playing"];
    },
  },
  {
    name: "tap the bar during a hold",
    weight: 2,
    run: async (c) => {
      await c.driver.pointerDown("playlist-next");
      await c.driver.wait(c.between(MIN_HOLD_MS, 2500));
      await c.driver.pointerUp();
      await c.driver.wait(c.between(0, 400));
      await c.driver.tapBar(c.between(0.05, 0.9));
      return ["playing", "stopped"];
    },
  },
  {
    name: "pause, wait, resume",
    weight: 3,
    run: async (c) => {
      await c.driver.tap("playlist-pause");
      await c.driver.wait(c.between(300, 4000));
      await c.driver.tap("playlist-pause");
      // Two taps are pause then resume however fast the first one took effect.
      return ["playing"];
    },
  },
  {
    name: "pause during a hold",
    weight: 2,
    run: async (c) => {
      await c.driver.pointerDown("playlist-next");
      await c.driver.wait(c.between(MIN_HOLD_MS, 2500));
      await c.driver.tap("playlist-pause");
      await c.driver.pointerUp();
      await c.driver.wait(c.between(500, 3000));
      await resumeIfPaused(c.driver);
      return ["playing", "stopped"];
    },
  },
  {
    name: "pause during a jump",
    weight: 2,
    run: async (c) => {
      await c.driver.tapBar(c.between(0.2, 0.95));
      await c.driver.wait(c.between(100, 1500));
      await c.driver.tap("playlist-pause");
      await c.driver.wait(c.between(500, 3000));
      await resumeIfPaused(c.driver);
      return ["playing"];
    },
  },
  {
    name: "stop during a jump, then play again",
    weight: 2,
    run: async (c) => {
      await c.driver.tapBar(c.between(0.2, 0.95));
      await c.driver.wait(c.between(100, 1500));
      await c.driver.tap("playlist-play");
      await c.driver.wait(c.between(MIN_HOLD_MS, 2500));
      await c.driver.startTune(c.route);
      return ["playing"];
    },
  },
  {
    name: "stop during a hold, then play again",
    weight: 1,
    run: async (c) => {
      await c.driver.pointerDown("playlist-prev");
      await c.driver.wait(c.between(MIN_HOLD_MS, 2500));
      await c.driver.tap("playlist-play");
      await c.driver.pointerUp();
      await c.driver.wait(c.between(500, 2000));
      await c.driver.startTune(c.route);
      return ["playing"];
    },
  },
  {
    name: "app to the background during a hold",
    weight: 2,
    needs: (driver) => Boolean(driver.disrupt),
    run: async (c) => {
      await c.driver.pointerDown("playlist-next");
      await c.driver.wait(c.between(MIN_HOLD_MS, 2500));
      await c.driver.disrupt!("background", c.between(1000, 8000));
      await c.driver.pointerUp();
      await resumeIfPaused(c.driver);
      return ["playing"];
    },
  },
  {
    name: "app killed during a hold",
    weight: 2,
    needs: (driver) => Boolean(driver.disrupt),
    run: async (c) => {
      await c.driver.pointerDown("playlist-next");
      await c.driver.wait(c.between(MIN_HOLD_MS, 3000));
      await c.driver.disrupt!("kill", 1000);
      await c.driver.pointerUp();
      await c.driver.startTune(c.route);
      return ["playing"];
    },
  },
  {
    name: "app killed during a jump",
    weight: 1,
    needs: (driver) => Boolean(driver.disrupt),
    run: async (c) => {
      await c.driver.tapBar(c.between(0.2, 0.95));
      await c.driver.wait(c.between(200, 2500));
      await c.driver.disrupt!("kill", 1000);
      await c.driver.startTune(c.route);
      return ["playing"];
    },
  },
];

const pick = (actions: Action[], random: () => number) => {
  let roll = random() * actions.reduce((sum, action) => sum + action.weight, 0);
  for (const action of actions) {
    roll -= action.weight;
    if (roll <= 0) return action;
  }
  return actions[actions.length - 1];
};

/**
 * Wait until no seek shows on the page and the machine has its settings back: the page shows a
 * landing before the restore's config writes are done. What is still wrong after that is a fault.
 */
const waitIdle = async (driver: ChaosDriver, route: ParityRoute) => {
  const started = Date.now();
  await landedSeconds(driver);
  while (Date.now() - started < IDLE_TIMEOUT_MS) {
    if ((await driver.shownSeconds()) !== null && (await driver.machineLeftChanged(route)).length === 0) return;
    await driver.wait(500);
  }
};

const SEEKING_OFFERED_WITHIN_MS = 10_000;

/** Seeking must be offered while a tune plays; a gesture made before that changes the track. */
const waitForSeeking = async (driver: ChaosDriver) => {
  for (let waited = 0; waited < SEEKING_OFFERED_WITHIN_MS; waited += 250) {
    if (await driver.seekingOffered()) return;
    await driver.wait(250);
  }
  throw new ParityFailure(`seeking was not offered within ${SEEKING_OFFERED_WITHIN_MS} ms of playing`);
};

/** Check everything that must hold once the app is idle; returns what does not. */
const violationsAfter = async (driver: ChaosDriver, route: ParityRoute, allowed: TransportState[], since: number) => {
  const violations: string[] = [];
  const state = await driver.transportState();
  if (!allowed.includes(state)) violations.push(`the transport shows ${state}, expected ${allowed.join(" or ")}`);
  violations.push(...(await driver.machineLeftChanged(route)));
  if (state === "playing") {
    const truth = await driver.truthSeconds(route);
    const shown = await driver.shownSeconds();
    // At or past its end the tune belongs to the playlist's end handling, not to a seek.
    const nearEnd = truth !== null && truth >= (await driver.durationSeconds()) - 5;
    if (truth !== null && shown !== null && !nearEnd && Math.abs(shown - truth) > POSITION_TOLERANCE_SECONDS)
      violations.push(`the page shows ${shown} s, the tune is at ${truth.toFixed(1)} s`);
  }
  violations.push(...(await driver.errorsSince(since)).map((error) => `logged: ${error}`));
  return violations;
};

/**
 * Run random actions on `routes` for `minutes`, switching the output now and then. Never throws for a
 * violation: every record says what was wrong after it, so one run reports all of them.
 */
export const runChaos = async (
  driver: ChaosDriver,
  { seed, minutes, routes }: { seed: number; minutes: number; routes: ParityRoute[] },
): Promise<ChaosRecord[]> => {
  const random = seeded(seed);
  const between = (low: number, high: number) => low + random() * (high - low);
  const actions = CHAOS_ACTIONS.filter((action) => !action.needs || action.needs(driver));
  const records: ChaosRecord[] = [];
  const endAt = Date.now() + minutes * 60_000;
  let route = routes[0];
  await driver.startTune(route);
  for (let step = 1; Date.now() < endAt; step += 1) {
    if (routes.length > 1 && random() < 0.08) {
      route = routes[(routes.indexOf(route) + 1) % routes.length];
      await driver.startTune(route);
    }
    if ((await driver.transportState()) !== "playing") await driver.startTune(route);
    const action = pick(actions, random);
    const started = Date.now();
    let violations: string[];
    try {
      await waitForSeeking(driver);
      const allowed = await action.run({ driver, route, random, between });
      await waitIdle(driver, route);
      violations = await violationsAfter(driver, route, allowed, started);
    } catch (error) {
      violations = [`failed: ${error instanceof Error ? error.message : String(error)}`];
      await driver.pointerUp().catch((releaseError: unknown) => {
        violations.push(`could not lift the finger: ${String(releaseError)}`);
      });
      await driver.startTune(route).catch((restartError: unknown) => {
        violations.push(`could not start the tune again: ${String(restartError)}`);
      });
    }
    const log = violations.length && driver.diagnose ? await driver.diagnose(started) : undefined;
    records.push({ step, action: action.name, route, ms: Date.now() - started, violations, log });
    driver.report?.(
      `${step} ${route} ${action.name}: ${violations.length ? `VIOLATION ${violations.join("; ")}` : "ok"} (${Date.now() - started} ms)${log ? `\n  ${log.join("\n  ")}` : ""}`,
    );
  }
  return records;
};
