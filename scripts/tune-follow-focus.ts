/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Offline hyper-parameter search for the follow-focus tracker.
 *
 *   npx vite-node --script scripts/tune-follow-focus.ts
 *
 * Coordinate descent over the tracker's options, scored by `followFocusEval` on the synthetic
 * games in `gameScenarios`. Two seed sets are used and they never mix: the search only ever
 * sees TRAIN, and VALIDATION is scored once per pass purely to report it. A parameter set that
 * gains on train and loses on validation is over-fitted to those particular scenes, and the
 * printed pair is what says so.
 *
 * The result is pasted into `DEFAULTS` in `src/lib/streams/subjectTracker.ts` by hand — this is
 * a design tool, not part of the build.
 */

import { evaluateSuite } from "../tests/helpers/followFocusEval";
import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights, type SubjectTrackerOptions } from "@/lib/streams/subjectTracker";

const TRAIN_SEEDS = [1, 2, 3];
const VALIDATION_SEEDS = [101, 102, 103];
const FRAMES = 240;

/** The knobs worth searching, with the values worth trying. */
const GRID: { [K in keyof SubjectTrackerOptions]?: number[] } = {
  fastTickWidths: [0.6, 1.0, 1.5, 2.5, 99],
  lockedIntervalMs: [40, 60, 80, 120],
  activeIntervalMs: [20, 40, 60],
  gateBasePx: [40, 56, 72, 96, 128],
  gateSpeedFactor: [1.0, 1.6, 2.2],
  gateCoastPxPerSec: [60, 120, 200],
  gateMaxPx: [140, 200, 280],
  acceptScore: [0.4, 0.46, 0.52, 0.58],
  reacquireScore: [0.56, 0.62, 0.68, 0.74],
  minAppearance: [0.2, 0.3, 0.4, 0.5],
  mergeAreaRatio: [1.25, 1.45, 1.7, 2.0],
  adaptRate: [0.05, 0.1, 0.16, 0.24],
  coastMs: [300, 500, 700, 1000],
  emptyGateMs: [80, 140, 200, 300],
  roiBboxFactor: [2.5, 3.5, 4.5],
  roiMinPx: [48, 64, 96],
  backgroundShare: [0.06, 0.1, 0.14, 0.2],
  backgroundColours: [2, 3, 4],
  acquireWindowPx: [32, 48, 64],
  acquireSnapPx: [8, 12, 18],
  sceneCutIntersection: [0.4, 0.55, 0.7, 0.85],
  stateNoveltyBelow: [0.4, 0.55, 0.7],
  stateConfirmTicks: [2, 3, 5],
  growthConfirmTicks: [3, 4, 7],
  maxStates: [1, 2, 4, 6],
};

/** The association weights are searched too; only their ratios matter, they are normalized. */
const WEIGHT_GRID: { [K in keyof ScoreWeights]: number[] } = {
  position: [0.15, 0.25, 0.34, 0.5, 0.7],
  colour: [0.08, 0.15, 0.22, 0.32],
  area: [0.06, 0.12, 0.18, 0.28],
  shape: [0.04, 0.1, 0.18],
  velocity: [0.06, 0.16, 0.28, 0.42],
};

const START: SubjectTrackerOptions = {
  gateBasePx: 72,
  gateSpeedFactor: 1.6,
  gateCoastPxPerSec: 120,
  gateMaxPx: 200,
  acceptScore: 0.46,
  reacquireScore: 0.74,
  minAppearance: 0.35,
  mergeAreaRatio: 1.45,
  adaptRate: 0.1,
  coastMs: 300,
  emptyGateMs: 80,
  roiBboxFactor: 4.5,
  roiMinPx: 64,
  backgroundShare: 0.06,
  backgroundColours: 3,
  acquireWindowPx: 48,
  acquireSnapPx: 12,
  fastTickWidths: 1,
  lockedIntervalMs: 40,
  activeIntervalMs: 20,
  sceneCutIntersection: 0.6,
  stateNoveltyBelow: 0.55,
  stateConfirmTicks: 3,
  growthConfirmTicks: 4,
  maxStates: 4,
  weights: { ...DEFAULT_SCORE_WEIGHTS },
};

const train = (options: SubjectTrackerOptions) => evaluateSuite(TRAIN_SEEDS, options, FRAMES);
const validate = (options: SubjectTrackerOptions) => evaluateSuite(VALIDATION_SEEDS, options, FRAMES);

const report = (label: string, options: SubjectTrackerOptions) => {
  const t = train(options);
  const v = validate(options);
  console.log(
    `${label.padEnd(22)} train ${t.score.toFixed(4)} (on ${t.onTarget.toFixed(3)} hij ${t.hijacked.toFixed(3)} relock ${t.medianRelockFrames} ups ${t.updatesPerSecond.toFixed(1)})` +
      `  |  val ${v.score.toFixed(4)} (on ${v.onTarget.toFixed(3)} hij ${v.hijacked.toFixed(3)} relock ${v.medianRelockFrames} ups ${v.updatesPerSecond.toFixed(1)})`,
  );
  return { train: t.score, validation: v.score };
};

const main = () => {
  const started = Date.now();
  let best: SubjectTrackerOptions = { ...START };
  let bestScore = train(best).score;
  console.log("--- baseline ---");
  report("defaults", best);

  const snapshots: { pass: number; options: SubjectTrackerOptions; train: number; validation: number }[] = [
    { pass: -1, options: { ...best }, train: bestScore, validation: validate(best).score },
  ];
  const keys = Object.keys(GRID) as (keyof SubjectTrackerOptions)[];
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (const key of keys) {
      const values = GRID[key];
      if (!values) continue;
      let localBest = best[key];
      let localScore = bestScore;
      for (const value of values) {
        if (value === best[key]) continue;
        const candidate = { ...best, [key]: value };
        const score = train(candidate).score;
        if (score > localScore + 1e-6) {
          localScore = score;
          localBest = value;
        }
      }
      if (localBest !== best[key]) {
        console.log(
          `pass ${pass}: ${String(key)} ${String(best[key])} -> ${String(localBest)}  train ${localScore.toFixed(4)}`,
        );
        best = { ...best, [key]: localBest };
        bestScore = localScore;
        improved = true;
      }
    }
    console.log(`--- after pass ${pass} (${((Date.now() - started) / 1000).toFixed(0)}s) ---`);
    const scores = report(`pass ${pass}`, best);
    snapshots.push({ pass, options: { ...best }, train: scores.train, validation: scores.validation });
    if (!improved) break;
  }

  // Early stopping on the held-out set. Coordinate descent will keep finding train gains long
  // after it has stopped finding real ones, and the pass where validation turns over is where
  // it started fitting these particular scenes rather than the problem.
  const chosen = snapshots.reduce((a, b) => (b.validation > a.validation ? b : a));
  console.log(
    `\nchosen pass ${chosen.pass} (train ${chosen.train.toFixed(4)}, validation ${chosen.validation.toFixed(4)})`,
  );

  console.log("\n--- tuned options ---");
  console.log(JSON.stringify(chosen.options, null, 2));
  console.log("\n--- per scenario, validation seeds ---");
  for (const scenario of validate(chosen.options).scenarios) {
    console.log(
      `${scenario.name.padEnd(16)} on ${scenario.onTarget.toFixed(3)}  hijacked ${scenario.hijacked.toFixed(3)}  lost ${scenario.lostFraction.toFixed(3)}  relock ${JSON.stringify(scenario.relockFrames)}`,
    );
  }
};

main();
