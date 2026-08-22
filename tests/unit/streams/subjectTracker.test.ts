/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The follow-focus subject tracker, against synthetic frames.
 *
 * Every case here is one of the things a real game does to a tracker: the player's sprite
 * flashes, animates, moves faster than a gate, is hidden for a moment, and is crossed by
 * something that looks exactly like it. The assertions are on the tracked position and on the
 * confidence — a tracker that quietly changed identity would still "track something", so the
 * decoy case checks WHICH object it kept.
 */

import { describe, expect, it } from "vitest";
import { SubjectTracker, scoreCandidate, wrapDelta } from "@/lib/streams/subjectTracker";
import { createFrame, drawMask, fillRect, FRAME_HEIGHT, FRAME_WIDTH, speckle } from "../../helpers/vicFrames";

const BACKGROUND = 6; // blue
const PLAYER = 2; // red
const SIZE = 19; // odd, so a box's centroid is exactly the centre a test asks for
const TICK_MS = 20; // one PAL frame, so a test can talk in frames

/** Frame time in the tracker's own terms; `update` takes elapsed ms, not a frame count. */
const play = (tracker: SubjectTracker, frame: Uint8Array) => tracker.update(frame, FRAME_WIDTH, FRAME_HEIGHT, TICK_MS);

const sceneWith = (
  boxes: ReadonlyArray<{ x: number; y: number; colour: number; size?: number }>,
  textured = false,
): Uint8Array => {
  const frame = createFrame(BACKGROUND);
  if (textured) speckle(frame, 14, 16);
  for (const box of boxes) {
    fillRect(frame, Math.round(box.x), Math.round(box.y), box.size ?? SIZE, box.size ?? SIZE, box.colour);
  }
  return frame;
};

/** Top-left of a box whose drawn centroid is exactly `(cx, cy)`. */
const at = (cx: number, cy: number, size = SIZE) => ({ x: cx - (size - 1) / 2, y: cy - (size - 1) / 2 });

const trackedPx = (result: ReturnType<SubjectTracker["update"]>) => ({
  x: (result.subject?.x ?? NaN) * FRAME_WIDTH,
  y: (result.subject?.y ?? NaN) * FRAME_HEIGHT,
});

const acquireAt = (tracker: SubjectTracker, frame: Uint8Array, cx: number, cy: number) =>
  tracker.acquire(frame, FRAME_WIDTH, FRAME_HEIGHT, cx / FRAME_WIDTH, cy / FRAME_HEIGHT);

describe("SubjectTracker.acquire — picking an object out of the picture", () => {
  it("locks on to the blob under the point, with its centre and size", () => {
    const tracker = new SubjectTracker();
    const frame = sceneWith([{ ...at(120, 100), colour: PLAYER }]);

    const result = acquireAt(tracker, frame, 120, 100);

    expect(result.state).toBe("locked");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(trackedPx(result).x).toBeCloseTo(120, 0);
    expect(trackedPx(result).y).toBeCloseTo(100, 0);
    expect((result.subject?.w ?? 0) * FRAME_WIDTH).toBeCloseTo(SIZE, 0);
    expect((result.subject?.h ?? 0) * FRAME_HEIGHT).toBeCloseTo(SIZE, 0);
    expect(result.nextIntervalMs).toBe(40);
  });

  it("snaps to a nearby object when the finger lands just off it", () => {
    const tracker = new SubjectTracker();
    const frame = sceneWith([{ ...at(200, 150), colour: PLAYER }]);

    // 14px right of the box's centre, so 5px outside its edge.
    const result = acquireAt(tracker, frame, 214, 150);

    expect(result.state).toBe("locked");
    expect(trackedPx(result).x).toBeCloseTo(200, 0);
  });

  it("refuses to lock on to empty background rather than following nothing", () => {
    const tracker = new SubjectTracker();
    const frame = sceneWith([{ ...at(50, 50), colour: PLAYER }]);

    const result = acquireAt(tracker, frame, 300, 200);

    expect(result.state).toBe("idle");
    expect(result.subject).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("finds the object against a textured backdrop, not the texture", () => {
    const tracker = new SubjectTracker();
    const frame = sceneWith([{ ...at(160, 120), colour: PLAYER }], true);

    const result = acquireAt(tracker, frame, 160, 120);

    expect(result.state).toBe("locked");
    expect(trackedPx(result).x).toBeCloseTo(160, 0);
    expect((result.subject?.w ?? 0) * FRAME_WIDTH).toBeLessThan(SIZE + 4);
  });

  it("release() gives the target up", () => {
    const tracker = new SubjectTracker();
    acquireAt(tracker, sceneWith([{ ...at(120, 100), colour: PLAYER }]), 120, 100);
    tracker.release();
    expect(tracker.state).toBe("idle");
    expect(play(tracker, sceneWith([{ ...at(120, 100), colour: PLAYER }])).subject).toBeNull();
  });
});

describe("SubjectTracker.update — ordinary motion", () => {
  it("stays on a subject moving 3px a frame for 40 frames", () => {
    const tracker = new SubjectTracker();
    let x = 80;
    const y = 130;
    acquireAt(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]), x, y);

    let last = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    for (let frame = 0; frame < 40; frame += 1) {
      x += 3;
      last = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
      expect(last.state).toBe("locked");
    }

    expect(trackedPx(last).x).toBeCloseTo(x, -0.5);
    expect(trackedPx(last).y).toBeCloseTo(y, -0.5);
    expect(last.confidence).toBeGreaterThan(0.7);
    // The velocity estimate is what carries the subject through an occlusion, so it has to be
    // right while nothing is wrong: 3px per 20ms is 150px/s.
    expect((last.subject?.vx ?? 0) * FRAME_WIDTH).toBeGreaterThan(100);
    expect((last.subject?.vx ?? 0) * FRAME_WIDTH).toBeLessThan(200);
  });

  it("asks to run at 25 Hz while locked and 50 Hz while recovering", () => {
    const tracker = new SubjectTracker();
    const frame = sceneWith([{ ...at(120, 100), colour: PLAYER }]);
    expect(acquireAt(tracker, frame, 120, 100).nextIntervalMs).toBe(40);
    const gone = play(tracker, sceneWith([]));
    expect(gone.state).toBe("coasting");
    expect(gone.nextIntervalMs).toBe(20);
  });
});

describe("the hard cases a game presents", () => {
  it("keeps the subject through a colour flash and a permanent recolour", () => {
    const tracker = new SubjectTracker();
    let x = 100;
    const y = 140;
    acquireAt(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]), x, y);
    play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));

    // Eight frames of flashing through unrelated palette entries, then a new colour for good.
    const flash = [1, 7, 13, 3, 1, 7, 13, 3];
    const states: string[] = [];
    for (let frame = 0; frame < flash.length; frame += 1) {
      x += 4;
      const result = play(tracker, sceneWith([{ ...at(x, y), colour: flash[frame] }]));
      states.push(result.state);
    }
    let last = play(tracker, sceneWith([{ ...at(x, y), colour: 8 }]));
    for (let frame = 0; frame < 20; frame += 1) {
      x += 4;
      last = play(tracker, sceneWith([{ ...at(x, y), colour: 8 }]));
    }

    expect(states.every((state) => state === "locked")).toBe(true);
    expect(last.state).toBe("locked");
    expect(trackedPx(last).x).toBeCloseTo(x, -0.5);
    expect(last.confidence).toBeGreaterThan(0.7);
  });

  it("keeps the subject while its silhouette animates", () => {
    const standing = [
      "..####..",
      ".######.",
      ".######.",
      "..####..",
      "..####..",
      "..####..",
      "..####..",
      "..####..",
      "..####..",
      "..##.##.",
      "..##.##.",
      "..##.##.",
    ];
    const striding = [
      "..####..",
      ".######.",
      ".######.",
      "..####..",
      "#######.",
      "#######.",
      "..####..",
      "..####..",
      ".##..##.",
      "##....##",
      "##....##",
      "##....##",
    ];
    const scene = (x: number, y: number, walking: boolean) => {
      const frame = createFrame(BACKGROUND);
      drawMask(frame, walking ? striding : standing, x, y, PLAYER);
      return frame;
    };

    const tracker = new SubjectTracker();
    let x = 150;
    const y = 120;
    acquireAt(tracker, scene(x, y, false), x + 4, y + 6);

    let last = play(tracker, scene(x, y, false));
    for (let frame = 0; frame < 30; frame += 1) {
      x += 2;
      last = play(tracker, scene(x, y, frame % 2 === 0));
      expect(last.state).toBe("locked");
    }

    expect(trackedPx(last).x).toBeCloseTo(x + 4, -0.7);
    expect(trackedPx(last).y).toBeCloseTo(y + 6, -0.7);
  });

  it("catches up with a subject moving 40px a frame, including across the screen wrap", () => {
    const tracker = new SubjectTracker();
    let x = 60;
    const y = 160;
    acquireAt(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]), x, y);
    play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));

    let locked = 0;
    let last = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    for (let frame = 0; frame < 60; frame += 1) {
      x = (x + 40) % FRAME_WIDTH;
      last = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
      if (last.state === "locked") locked += 1;
    }

    // Six full laps of the frame at 40px a frame. Measured: 60 of 60 frames locked, worst
    // in-frame error 27px; the bar is set below that so a real regression trips it.
    expect(locked).toBeGreaterThanOrEqual(55);
    expect(last.state).toBe("locked");
    expect(Math.abs(wrapDelta(trackedPx(last).x, x, FRAME_WIDTH))).toBeLessThan(12);
  });

  it("coasts through a five-frame occlusion and re-locks where the subject reappears", () => {
    const tracker = new SubjectTracker();
    let x = 120;
    const y = 130;
    acquireAt(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]), x, y);
    for (let frame = 0; frame < 10; frame += 1) {
      x += 4;
      play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    }

    // Four frames of coasting, and then the search widens: nothing at all inside the gate means
    // the subject moved rather than went behind something, and that is not worth waiting out the
    // full coast for. What it must never do is report a lock while there is nothing there.
    const hidden: number[] = [];
    const states: string[] = [];
    for (let frame = 0; frame < 5; frame += 1) {
      x += 4;
      const result = play(tracker, sceneWith([]));
      states.push(result.state);
      hidden.push(trackedPx(result).x);
    }
    expect(states).toEqual(["coasting", "coasting", "coasting", "coasting", "searching"]);

    // Coasting is not standing still: the subject was moving, so the prediction moves with it.
    expect(hidden[4]).toBeGreaterThan(hidden[0]);
    expect(Math.abs(hidden[4] - x)).toBeLessThan(24);

    x += 4;
    const back = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    expect(back.state).toBe("locked");
    // Found where the prediction said, so the motion model survived the blink rather than being
    // thrown away and rebuilt.
    expect((back.subject?.vx ?? 0) * FRAME_WIDTH).toBeGreaterThan(50);
    // The filter takes half the residual on the first measurement, so the catch-up is a couple
    // of frames rather than a snap; both the first frame and the settled value are asserted.
    expect(Math.abs(trackedPx(back).x - x)).toBeLessThan(6);
    let settled = back;
    for (let frame = 0; frame < 4; frame += 1) {
      x += 4;
      settled = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    }
    expect(settled.state).toBe("locked");
    expect(Math.abs(trackedPx(settled).x - x)).toBeLessThan(3);
  });

  it("keeps the right object when an identical decoy crosses it, and says it is unsure", () => {
    const tracker = new SubjectTracker();
    const y = 150;
    let subjectX = 130;
    let decoyX = 250;
    const scene = () =>
      sceneWith([
        { ...at(subjectX, y), colour: PLAYER },
        { ...at(decoyX, y), colour: PLAYER },
      ]);

    acquireAt(tracker, scene(), subjectX, y);
    for (let frame = 0; frame < 8; frame += 1) {
      subjectX += 3;
      decoyX -= 3;
      play(tracker, scene());
    }

    // Through the crossing: the two boxes are the same colour, the same size, and briefly the
    // same blob.
    let minConfidence = 1;
    let worstError = 0;
    for (let frame = 0; frame < 16; frame += 1) {
      subjectX += 3;
      decoyX -= 3;
      const result = play(tracker, scene());
      minConfidence = Math.min(minConfidence, result.confidence);
      worstError = Math.max(worstError, Math.abs(trackedPx(result).x - subjectX));
    }

    let last = play(tracker, scene());
    for (let frame = 0; frame < 10; frame += 1) {
      subjectX += 3;
      decoyX -= 3;
      last = play(tracker, scene());
    }

    // It came out the far side on the SUBJECT, not on the decoy that walked the other way.
    expect(Math.abs(trackedPx(last).x - subjectX)).toBeLessThan(8);
    expect(Math.abs(trackedPx(last).x - decoyX)).toBeGreaterThan(60);
    // ...and while it could not tell them apart it said so rather than reporting a clean lock.
    // Measured: confidence falls to 0.30 on the merged frames and the position never leaves the
    // subject by more than about 3px.
    expect(minConfidence).toBeLessThan(0.4);
    expect(worstError).toBeLessThan(10);
    // Confidence recovers once the two are separate again.
    expect(last.confidence).toBeGreaterThan(0.6);
  });

  it("declares the subject lost, once, when it is gone for good", () => {
    const tracker = new SubjectTracker({ coastMs: 200, searchMs: 400 });
    acquireAt(tracker, sceneWith([{ ...at(120, 100), colour: PLAYER }]), 120, 100);

    const empty = sceneWith([]);
    const states: string[] = [];
    for (let frame = 0; frame < 60; frame += 1) states.push(play(tracker, empty).state);

    expect(states).toContain("coasting");
    expect(states).toContain("searching");
    expect(states[states.length - 1]).toBe("lost");
    const final = play(tracker, empty);
    expect(final.subject).toBeNull();
    expect(final.confidence).toBe(0);
  });

  it("re-acquires after a long absence rather than staying lost", () => {
    const tracker = new SubjectTracker();
    const y = 120;
    acquireAt(tracker, sceneWith([{ ...at(100, y), colour: PLAYER }]), 100, y);
    for (let frame = 0; frame < 6; frame += 1) play(tracker, sceneWith([{ ...at(100, y), colour: PLAYER }]));

    // Off-screen long enough to reach the whole-frame search, then back on the far side.
    let state = "";
    for (let frame = 0; frame < 45; frame += 1) state = play(tracker, sceneWith([])).state;
    expect(state).toBe("searching");

    let last = play(tracker, sceneWith([{ ...at(300, 200), colour: PLAYER }]));
    for (let frame = 0; frame < 4; frame += 1) {
      last = play(tracker, sceneWith([{ ...at(300, 200), colour: PLAYER }]));
    }
    expect(last.state).toBe("locked");
    expect(trackedPx(last).x).toBeCloseTo(300, -1);
    expect(trackedPx(last).y).toBeCloseTo(200, -1);
  });
});

describe("learning the states a subject can be in", () => {
  /**
   * A sprite that grows, powers up or changes form is the same object wearing a different look.
   * Learning that is what keeps the view on it; learning the WRONG thing is how a tracker ends up
   * permanently following whatever happened to be next to it, so both directions are asserted.
   */
  it("learns a new look when the subject changes state, and follows it afterwards", () => {
    const tracker = new SubjectTracker();
    let x = 120;
    const y = 130;
    acquireAt(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]), x, y);
    for (let frame = 0; frame < 8; frame += 1) {
      x += 3;
      play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    }

    // Twice the size AND a different colour, from one frame to the next. Nothing about how it
    // looks says it is the same object; only where it is and where it was going does.
    const big = (cx: number) => sceneWith([{ ...at(cx, y, 38), colour: 5, size: 38 }]);
    let last = play(tracker, big(x));
    for (let frame = 0; frame < 20; frame += 1) {
      x += 3;
      last = play(tracker, big(x));
    }

    expect(last.state).toBe("locked");
    expect(trackedPx(last).x).toBeCloseTo(x, -1);
    expect((last.subject?.w ?? 0) * FRAME_WIDTH).toBeGreaterThan(30);

    // ...and it still knows its original look, so changing back is not a second re-acquisition.
    let back = last;
    for (let frame = 0; frame < 6; frame += 1) {
      x += 3;
      back = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    }
    expect(back.state).toBe("locked");
    expect(trackedPx(back).x).toBeCloseTo(x, -1);
    expect(back.confidence).toBeGreaterThan(0.5);
  });

  it("does not learn a sprite that merely brushes past it", () => {
    const tracker = new SubjectTracker();
    const y = 150;
    let subjectX = 130;
    let strangerX = 210;
    const scene = () =>
      sceneWith([
        { ...at(subjectX, y), colour: PLAYER },
        { ...at(strangerX, y), colour: 5 },
      ]);

    acquireAt(tracker, scene(), subjectX, y);
    for (let frame = 0; frame < 30; frame += 1) {
      subjectX += 3;
      strangerX -= 3;
      play(tracker, scene());
    }

    // The stranger has gone the other way. If its look had been learned, the tracker would now
    // accept it as the subject standing still somewhere else.
    let last = play(tracker, scene());
    for (let frame = 0; frame < 10; frame += 1) {
      subjectX += 3;
      strangerX -= 3;
      last = play(tracker, scene());
    }
    expect(Math.abs(trackedPx(last).x - subjectX)).toBeLessThan(12);
    expect(Math.abs(trackedPx(last).x - strangerX)).toBeGreaterThan(60);
  });

  it("follows a subject that doubles in size and shrinks back", () => {
    const tracker = new SubjectTracker();
    let x = 100;
    const y = 140;
    const grow = (cx: number, size: number) => sceneWith([{ x: cx - (size - 1) / 2, y: y - (size - 1) / 2, colour: PLAYER, size }]); // prettier-ignore

    acquireAt(tracker, grow(x, 15), x, y);
    for (let frame = 0; frame < 8; frame += 1) {
      x += 2;
      play(tracker, grow(x, 15));
    }

    let big = play(tracker, grow(x, 31));
    for (let frame = 0; frame < 18; frame += 1) {
      x += 2;
      big = play(tracker, grow(x, 31));
    }
    expect(big.state).toBe("locked");
    expect(trackedPx(big).x).toBeCloseTo(x, -1);

    let small = big;
    for (let frame = 0; frame < 12; frame += 1) {
      x += 2;
      small = play(tracker, grow(x, 15));
    }
    expect(small.state).toBe("locked");
    expect(trackedPx(small).x).toBeCloseTo(x, -1);
  });

  it("keeps only a bounded number of looks, so a flickering sprite cannot grow it forever", () => {
    const tracker = new SubjectTracker({ maxStates: 2, stateConfirmTicks: 2 });
    let x = 100;
    const y = 140;
    acquireAt(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]), x, y);

    // Six different looks in a row, each held long enough to be learned.
    let last = play(tracker, sceneWith([{ ...at(x, y), colour: PLAYER }]));
    for (const colour of [5, 7, 12, 13, 3, 10]) {
      for (let frame = 0; frame < 5; frame += 1) {
        x += 2;
        last = play(tracker, sceneWith([{ ...at(x, y), colour }]));
      }
    }
    expect(last.state).toBe("locked");
    expect(trackedPx(last).x).toBeCloseTo(x, -1);
  });
});

describe("scoreCandidate — the association rules, stated directly", () => {
  const hist = (colour: number, count = 100) => {
    const bins = new Float64Array(16);
    bins[colour] = count;
    return bins;
  };
  const model = {
    x: 100,
    y: 100,
    w: 18,
    h: 18,
    area: 324,
    vx: 150,
    vy: 0,
    hist: (() => {
      const bins = new Float64Array(16);
      bins[PLAYER] = 1;
      return bins;
    })(),
  };
  const context = { predictedX: 103, predictedY: 100, gatePx: 72, dtSec: 0.02, width: 384, height: 272 };

  it("accepts a subject that changed colour entirely, because colour is only one cue", () => {
    const recoloured = { x: 103, y: 100, w: 18, h: 18, area: 324, hist: hist(8) };
    const score = scoreCandidate(recoloured, model, context);

    expect(score.colour).toBe(0);
    expect(score.total).toBeGreaterThan(0.5); // the tracker's acceptScore
    expect(score.appearance).toBeGreaterThan(0.35); // ...and its minAppearance
  });

  it("prefers the candidate at the prediction over an identical one further away", () => {
    const onPath = { x: 103, y: 100, w: 18, h: 18, area: 324, hist: hist(PLAYER) };
    const offPath = { x: 133, y: 100, w: 18, h: 18, area: 324, hist: hist(PLAYER) };

    expect(scoreCandidate(onPath, model, context).total).toBeGreaterThan(scoreCandidate(offPath, model, context).total);
  });

  it("penalises a look-alike travelling the other way", () => {
    const sameWay = { x: 103, y: 100, w: 18, h: 18, area: 324, hist: hist(PLAYER) };
    const otherWay = { x: 97, y: 100, w: 18, h: 18, area: 324, hist: hist(PLAYER) };

    const towards = scoreCandidate(sameWay, model, context);
    const against = scoreCandidate(otherWay, model, context);
    expect(towards.velocity).toBeGreaterThan(against.velocity);
    expect(towards.total).toBeGreaterThan(against.total);
  });

  it("measures distance the short way round a wrapping axis", () => {
    expect(wrapDelta(4, 380, 384)).toBe(8);
    expect(wrapDelta(380, 4, 384)).toBe(-8);
    expect(wrapDelta(100, 40, 384)).toBe(60);
  });
});
