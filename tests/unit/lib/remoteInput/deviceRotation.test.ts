/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  fitStageSize,
  frameRotation,
  ORIENTATION_UNKNOWN,
  quantiseRotation,
  unrotateDelta,
  unrotatePoint,
} from "@/lib/remoteInput/deviceRotation";

describe("quantiseRotation", () => {
  it("snaps a settled angle to its sector", () => {
    expect(quantiseRotation(0, 0)).toBe(0);
    expect(quantiseRotation(92, 180)).toBe(90);
    expect(quantiseRotation(178, 0)).toBe(180);
    expect(quantiseRotation(268, 90)).toBe(270);
    expect(quantiseRotation(358, 180)).toBe(0);
  });

  it("does not switch 10° past a sector boundary", () => {
    expect(quantiseRotation(55, 0)).toBe(0);
    expect(quantiseRotation(35, 90)).toBe(90);
    expect(quantiseRotation(305, 0)).toBe(0);
  });

  it("switches 25° past a sector boundary", () => {
    expect(quantiseRotation(70, 0)).toBe(90);
    expect(quantiseRotation(20, 90)).toBe(0);
    expect(quantiseRotation(290, 0)).toBe(270);
  });

  it("holds the previous value while the handset lies flat", () => {
    expect(quantiseRotation(ORIENTATION_UNKNOWN, 90)).toBe(90);
    expect(quantiseRotation(ORIENTATION_UNKNOWN, 0)).toBe(0);
  });

  it("holds the previous value for an unusable reading", () => {
    expect(quantiseRotation(Number.NaN, 270)).toBe(270);
    expect(quantiseRotation(-12, 180)).toBe(180);
  });

  it("treats an angle past a full turn as its equivalent inside one", () => {
    expect(quantiseRotation(450, 0)).toBe(90);
  });
});

describe("frameRotation", () => {
  it("is the chassis rotation while the app is portrait-locked", () => {
    expect(frameRotation(0, 0)).toBe(0);
    expect(frameRotation(90, 0)).toBe(90);
    expect(frameRotation(270, 0)).toBe(270);
  });

  it("cancels out when the layout has turned with the chassis", () => {
    expect(frameRotation(90, 90)).toBe(0);
    expect(frameRotation(270, 270)).toBe(0);
  });

  it("wraps rather than going negative when the layout leads the chassis", () => {
    expect(frameRotation(0, 90)).toBe(270);
    expect(frameRotation(90, 180)).toBe(270);
  });
});

describe("unrotateDelta", () => {
  it("is the identity when nothing is turned", () => {
    expect(unrotateDelta(7, -3, 0)).toEqual({ x: 7, y: -3 });
  });

  it("maps (dx, dy) to (−dy, dx) at 90°", () => {
    expect(unrotateDelta(10, 0, 90)).toEqual({ x: 0, y: 10 });
    expect(unrotateDelta(0, 10, 90)).toEqual({ x: -10, y: 0 });
  });

  it("negates both axes at 180°", () => {
    expect(unrotateDelta(10, 4, 180)).toEqual({ x: -10, y: -4 });
  });

  it("maps (dx, dy) to (dy, −dx) at 270°", () => {
    expect(unrotateDelta(10, 0, 270)).toEqual({ x: 0, y: -10 });
    expect(unrotateDelta(0, 10, 270)).toEqual({ x: 10, y: 0 });
  });
});

describe("unrotatePoint", () => {
  const centre = { x: 100, y: 50 };

  it("measures from the stage centre, not the viewport origin", () => {
    expect(unrotatePoint(120, 50, centre, 0)).toEqual({ x: 20, y: 0 });
    expect(unrotatePoint(100, 50, centre, 90)).toEqual({ x: 0, y: 0 });
  });

  it("turns the offset into the stage's own frame", () => {
    expect(unrotatePoint(120, 50, centre, 90)).toEqual({ x: 0, y: 20 });
    expect(unrotatePoint(100, 70, centre, 90)).toEqual({ x: -20, y: 0 });
    expect(unrotatePoint(120, 50, centre, 180).x).toBe(-20);
    expect(unrotatePoint(120, 50, centre, 270)).toEqual({ x: 0, y: -20 });
  });
});

describe("fitStageSize", () => {
  const ASPECT = 384 / 272;

  it("letterboxes top and bottom when the container is wider than the frame", () => {
    expect(fitStageSize(800, 200, ASPECT, 0)).toEqual({ width: 200 * ASPECT, height: 200 });
  });

  it("letterboxes left and right when the container is taller than the frame", () => {
    expect(fitStageSize(384, 900, ASPECT, 0)).toEqual({ width: 384, height: 384 / ASPECT });
  });

  it("swaps the aspect at a quarter turn, so a tall container gains picture", () => {
    const upright = fitStageSize(400, 900, ASPECT, 0);
    const turned = fitStageSize(400, 900, ASPECT, 90);
    // The stage keeps the frame's own aspect; it is its ON-SCREEN bounding box
    // that turns, so 400 of container width becomes 400 of stage HEIGHT.
    expect(turned).toEqual({ width: 400 * ASPECT, height: 400 });
    expect(turned.width).toBeGreaterThan(upright.width);
  });

  it("gives the same size at 270° as at 90°, and at 180° as at 0°", () => {
    expect(fitStageSize(400, 900, ASPECT, 270)).toEqual(fitStageSize(400, 900, ASPECT, 90));
    expect(fitStageSize(400, 900, ASPECT, 180)).toEqual(fitStageSize(400, 900, ASPECT, 0));
  });

  it("returns nothing to draw for an unmeasured container", () => {
    expect(fitStageSize(0, 900, ASPECT, 0)).toEqual({ width: 0, height: 0 });
    expect(fitStageSize(400, 0, ASPECT, 0)).toEqual({ width: 0, height: 0 });
    expect(fitStageSize(400, 900, 0, 0)).toEqual({ width: 0, height: 0 });
  });
});
