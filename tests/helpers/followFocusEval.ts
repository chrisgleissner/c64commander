/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Scoring the follow-focus tracker against the synthetic games in `gameScenarios`.
 *
 * One number decides whether a change to the tracker is an improvement, and it is deliberately
 * lopsided: being ON the player is worth 1, and being confidently on something ELSE costs 1.5.
 * A tracker that gives up is bad; a tracker that silently follows the wrong sprite is worse,
 * because the player has no way to tell.
 *
 * `relockFrames` measures the other thing the feature is judged on — how long the view takes to
 * arrive after the player respawns or the room changes, where the position is a discontinuity
 * and no amount of smoothing helps.
 */

import { SubjectTracker, wrapDelta, type SubjectTrackerOptions } from "@/lib/streams/subjectTracker";
import { InputAffinity } from "@/lib/streams/inputAffinity";
import { FRAME_HEIGHT, FRAME_WIDTH } from "./vicFrames";
import { buildSuite, type Scenario } from "./gameScenarios";

/** Within this the view is on the player; the camera deadzone hides the rest. */
export const ON_TARGET_PX = 24;
/** Past this, with the tracker calling itself locked, it is following something else. */
export const HIJACKED_PX = 60;
/** Frames are delivered at the PAL rate; the tracker decimates for itself. */
const FRAME_MS = 20;

export interface ScenarioScore {
  name: string;
  onTarget: number;
  hijacked: number;
  lostFraction: number;
  /** Frames from each teleport until the view is back on the player; unrecovered ones are capped. */
  relockFrames: number[];
  /** Tracker updates per second of video — the CPU the scene actually asked for. */
  updatesPerSecond: number;
  score: number;
}

export interface SuiteScore {
  score: number;
  onTarget: number;
  hijacked: number;
  updatesPerSecond: number;
  medianRelockFrames: number;
  scenarios: ScenarioScore[];
}

/**
 * What a tick costs the objective. Tracking quality can always be bought with a higher rate, and
 * a search that is not told the price will spend the whole CPU budget on it — so the rate the
 * tracker asks for is part of what is being scored, at 0.05 for running flat out at 50 Hz.
 */
const COST_WEIGHT = 0.05;

const RELOCK_CAP = 120; // 2.4s — past this the view never arrived

let inputCueEnabled = true;

/**
 * A/B switch for the input-affinity cue. It exists so the cue can be shown to earn its place
 * against the same scenarios rather than assumed to, and so a regression test can pin the
 * tracker's behaviour with the cue off — which is what every user without the app's joystick
 * in their hands actually gets.
 */
export const setInputCueEnabled = (enabled: boolean): void => {
  inputCueEnabled = enabled;
};

export const evaluateScenario = (scenario: Scenario, options?: SubjectTrackerOptions): ScenarioScore => {
  const tracker = new SubjectTracker(options);
  // The scenario publishes what the app would have been asserting on each frame, so the cue is
  // scored the way it will be used: driven from real assertions, learning from accepted
  // measurements only, and worth nothing in the scenarios where the game does not answer.
  const affinity = new InputAffinity();
  const cueOn = inputCueEnabled;
  tracker.acquire(
    scenario.render(0),
    FRAME_WIDTH,
    FRAME_HEIGHT,
    scenario.pick.x / FRAME_WIDTH,
    scenario.pick.y / FRAME_HEIGHT,
  );

  let visibleFrames = 0;
  let onTarget = 0;
  let hijacked = 0;
  let lost = 0;
  const relockFrames: number[] = [];
  let pendingRelock = -1;
  let elapsedMs = 0;
  let nextIntervalMs = 0;
  let updates = 0;
  let lastResult = { state: "locked" as string, x: scenario.pick.x, y: scenario.pick.y, has: true };

  for (let index = 1; index < scenario.frameCount; index += 1) {
    const truth = scenario.truth(index);
    const asserted = scenario.input(index);
    affinity.assert(asserted.dx, asserted.dy, index * FRAME_MS);
    elapsedMs += FRAME_MS;
    // The tracker says how often it wants to run and the app honours it, so the score is of the
    // tracker AS DEPLOYED rather than of a per-frame version nobody ships.
    if (elapsedMs >= nextIntervalMs) {
      const nowMs = index * FRAME_MS;
      const expected = affinity.expected(nowMs - elapsedMs, nowMs);
      const result = tracker.update(scenario.render(index), FRAME_WIDTH, FRAME_HEIGHT, elapsedMs, {
        expected,
        scale: cueOn ? affinity.bonusScale : 0,
      });
      if (result.measured) affinity.observe(result.measured.dx, result.measured.dy, elapsedMs, expected);
      updates += 1;
      nextIntervalMs = result.nextIntervalMs;
      elapsedMs = 0;
      if (result.subject) {
        lastResult = {
          state: result.state,
          x: result.subject.x * FRAME_WIDTH,
          y: result.subject.y * FRAME_HEIGHT,
          has: true,
        };
      } else {
        lastResult = { ...lastResult, state: result.state, has: false };
      }
    }

    if (truth.teleported) pendingRelock = index;
    if (!truth.visible) continue;
    visibleFrames += 1;

    const dx = wrapDelta(lastResult.x, truth.x, FRAME_WIDTH);
    const dy = wrapDelta(lastResult.y, truth.y, FRAME_HEIGHT);
    const error = Math.sqrt(dx * dx + dy * dy);
    if (!lastResult.has) lost += 1;
    else if (error <= ON_TARGET_PX) onTarget += 1;
    else if (error > HIJACKED_PX && lastResult.state === "locked") hijacked += 1;

    if (pendingRelock >= 0 && lastResult.has && error <= ON_TARGET_PX) {
      relockFrames.push(Math.min(RELOCK_CAP, index - pendingRelock));
      pendingRelock = -1;
    }
  }
  if (pendingRelock >= 0) relockFrames.push(RELOCK_CAP);

  const denominator = Math.max(1, visibleFrames);
  const onTargetRate = onTarget / denominator;
  const hijackedRate = hijacked / denominator;
  const updatesPerSecond = updates / ((scenario.frameCount * FRAME_MS) / 1000);
  return {
    name: scenario.name,
    onTarget: onTargetRate,
    hijacked: hijackedRate,
    lostFraction: lost / denominator,
    relockFrames,
    updatesPerSecond,
    score: onTargetRate - 1.5 * hijackedRate - COST_WEIGHT * (updatesPerSecond / 50),
  };
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export const evaluateSuite = (
  seeds: readonly number[],
  options?: SubjectTrackerOptions,
  frameCount = 240,
): SuiteScore => {
  const scenarios: ScenarioScore[] = [];
  for (const seed of seeds) {
    for (const scenario of buildSuite(seed, frameCount)) scenarios.push(evaluateScenario(scenario, options));
  }
  const mean = (pick: (s: ScenarioScore) => number) =>
    scenarios.reduce((sum, s) => sum + pick(s), 0) / scenarios.length;
  return {
    score: mean((s) => s.score),
    onTarget: mean((s) => s.onTarget),
    hijacked: mean((s) => s.hijacked),
    updatesPerSecond: mean((s) => s.updatesPerSecond),
    medianRelockFrames: median(scenarios.flatMap((s) => s.relockFrames)),
    scenarios,
  };
};
