/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { bench, describe } from "vitest";
import { SubjectTracker } from "@/lib/streams/subjectTracker";
import { MotionTracker } from "@/lib/streams/motionTracker";
import { advanceFollowCamera } from "@/lib/streams/followCamera";
import { buildScenario } from "../helpers/gameScenarios";
import { createFrame, fillRect, FRAME_HEIGHT, FRAME_WIDTH } from "../helpers/vicFrames";

/**
 * Host microbenchmarks for follow-focus. The number that matters is the cost of ONE tracker
 * tick, because that is what is added to a device already decoding 50 frames a second and
 * feeding an audio pipeline that must not underrun. Run:
 *   npx vitest bench tests/benchmarks/followFocus.bench.ts --project unit-node --run
 *
 * The three tracker states have very different costs and all three are measured: `locked` scans
 * a small region around the prediction, `searching` scans the whole frame at a coarser step, and
 * `acquire` runs once per long press.
 */

const SIZE = 19;
const BACKGROUND = 6;
const PLAYER = 2;

const box = (x: number, y: number): Uint8Array => {
  const frame = createFrame(BACKGROUND);
  fillRect(frame, x - 9, y - 9, SIZE, SIZE, PLAYER);
  fillRect(frame, 300, 60, SIZE, SIZE, 10);
  fillRect(frame, 60, 220, SIZE, SIZE, 12);
  return frame;
};

/** A pre-rolled locked tracker plus the frames it will be fed, so the bench times only the tick. */
const lockedTracker = (): { tracker: SubjectTracker; frames: Uint8Array[] } => {
  const tracker = new SubjectTracker();
  const frames: Uint8Array[] = [];
  for (let i = 0; i < 16; i += 1) frames.push(box(120 + i * 4, 130));
  tracker.acquire(frames[0], FRAME_WIDTH, FRAME_HEIGHT, 120 / FRAME_WIDTH, 130 / FRAME_HEIGHT);
  for (let i = 1; i < 4; i += 1) tracker.update(frames[i], FRAME_WIDTH, FRAME_HEIGHT, 80);
  return { tracker, frames };
};

const locked = lockedTracker();
let lockedIndex = 0;

const searching = (() => {
  const tracker = new SubjectTracker({ coastMs: 0, searchMs: 1e9 });
  const frame = box(120, 130);
  tracker.acquire(frame, FRAME_WIDTH, FRAME_HEIGHT, 120 / FRAME_WIDTH, 130 / FRAME_HEIGHT);
  const empty = createFrame(BACKGROUND);
  for (let i = 0; i < 4; i += 1) tracker.update(empty, FRAME_WIDTH, FRAME_HEIGHT, 80);
  return { tracker, empty };
})();

const acquireFrame = box(120, 130);
const acquireTracker = new SubjectTracker();

const motion = new MotionTracker();
motion.update(box(120, 130), FRAME_WIDTH, FRAME_HEIGHT);
const motionFrames = [box(124, 130), box(128, 130)];
let motionIndex = 0;

const scenario = buildScenario("platformer", 1, 120);
const scenarioTracker = new SubjectTracker();
scenarioTracker.acquire(
  scenario.render(0),
  FRAME_WIDTH,
  FRAME_HEIGHT,
  scenario.pick.x / FRAME_WIDTH,
  scenario.pick.y / FRAME_HEIGHT,
);
let scenarioIndex = 0;

describe("Live View follow-focus", () => {
  bench("subject tracker tick — locked (region scan)", () => {
    lockedIndex = (lockedIndex + 1) % locked.frames.length;
    locked.tracker.update(locked.frames[lockedIndex], FRAME_WIDTH, FRAME_HEIGHT, 80);
  });

  bench("subject tracker tick — searching (whole-frame scan)", () => {
    searching.tracker.update(searching.empty, FRAME_WIDTH, FRAME_HEIGHT, 40);
  });

  bench("subject tracker tick — a real scene (platformer)", () => {
    scenarioIndex = (scenarioIndex + 1) % scenario.frameCount;
    scenarioTracker.update(scenario.render(scenarioIndex), FRAME_WIDTH, FRAME_HEIGHT, 80);
  });

  bench("subject acquire (one long press)", () => {
    acquireTracker.acquire(acquireFrame, FRAME_WIDTH, FRAME_HEIGHT, 120 / FRAME_WIDTH, 130 / FRAME_HEIGHT);
  });

  bench("motion tracker tick — the follow-motion baseline it sits on top of", () => {
    motionIndex = (motionIndex + 1) % motionFrames.length;
    motion.update(motionFrames[motionIndex], FRAME_WIDTH, FRAME_HEIGHT);
  });

  bench("follow camera advance", () => {
    advanceFollowCamera({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5, vx: 0.3, vy: 0 }, 80, { deadzone: 0.02 });
  });
});
