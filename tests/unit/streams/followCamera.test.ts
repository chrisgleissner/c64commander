/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The follow camera. Two failure modes matter and both are unusable: a camera that copies a
 * jittering centroid shakes the whole picture, and one that merely eases toward the subject
 * leaves it behind whenever it moves. The tests below pin down each.
 */

import { describe, expect, it } from "vitest";
import { advanceFollowCamera } from "@/lib/streams/followCamera";

const still = (x: number, y: number) => ({ x, y, vx: 0, vy: 0 });

describe("advanceFollowCamera", () => {
  it("eases toward a stationary aim instead of jumping to it", () => {
    const step = advanceFollowCamera({ x: 0.5, y: 0.5 }, still(0.8, 0.5), 80);
    expect(step.x).toBeGreaterThan(0.5);
    expect(step.x).toBeLessThan(0.8);
  });

  it("converges on a stationary aim", () => {
    let camera = { x: 0.5, y: 0.5 };
    for (let tick = 0; tick < 40; tick += 1) camera = advanceFollowCamera(camera, still(0.8, 0.2), 80);
    expect(camera.x).toBeCloseTo(0.8, 3);
    expect(camera.y).toBeCloseTo(0.2, 3);
  });

  it("keeps up with a subject moving at constant speed instead of trailing it", () => {
    const speed = 0.4; // frame widths per second
    let camera = { x: 0.2, y: 0.5 };
    let subject = 0.2;
    for (let tick = 0; tick < 60; tick += 1) {
      subject += speed * 0.04;
      camera = advanceFollowCamera(camera, { x: subject, y: 0.5, vx: speed, vy: 0 }, 40);
    }
    // The velocity feed-forward is what makes this small; without it the camera settles a whole
    // time constant behind, which at 0.4/s and tau 140ms is 0.056 — an eighth of the frame.
    expect(Math.abs(camera.x - subject)).toBeLessThan(0.01);
  });

  it("ignores movement inside the deadzone, so a jittering centroid does not shake the view", () => {
    const camera = { x: 0.5, y: 0.5 };
    const jittered = advanceFollowCamera(camera, still(0.505, 0.497), 80, { deadzone: 0.02 });
    expect(jittered).toBe(camera);
  });

  it("settles on the edge of the deadzone rather than hunting across it", () => {
    let camera = { x: 0.5, y: 0.5 };
    for (let tick = 0; tick < 60; tick += 1)
      camera = advanceFollowCamera(camera, still(0.6, 0.5), 80, { deadzone: 0.02 });
    expect(camera.x).toBeCloseTo(0.58, 3);
  });

  it("jumps rather than travels when the subject is no longer in view", () => {
    // A respawn or a room change. Smoothing it means seconds of watching scenery the player has
    // already left, so past the snap distance the speed cap does not apply.
    const jumped = advanceFollowCamera({ x: 0.2, y: 0.2 }, { x: 0.9, y: 0.8, vx: 0, vy: 0 }, 40, {
      snapDistance: 0.25,
      maxSpeedPerSec: 1,
    });
    expect(jumped.x).toBe(0.9);
    expect(jumped.y).toBe(0.8);
  });

  it("still eases for a subject that is merely across the visible region", () => {
    const eased = advanceFollowCamera({ x: 0.5, y: 0.5 }, still(0.6, 0.5), 40, { snapDistance: 0.25 });
    expect(eased.x).toBeGreaterThan(0.5);
    expect(eased.x).toBeLessThan(0.6);
  });

  it("ignores a stale velocity when it snaps, because a teleport says nothing about direction", () => {
    const jumped = advanceFollowCamera({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5, vx: -5, vy: 0 }, 40, {
      snapDistance: 0.2,
    });
    expect(jumped.x).toBe(0.9);
  });

  it("caps how fast the view can travel", () => {
    const step = advanceFollowCamera({ x: 0.1, y: 0.5 }, still(0.9, 0.5), 100, { maxSpeedPerSec: 1 });
    expect(step.x - 0.1).toBeCloseTo(0.1, 6);
  });

  it("holds still for a zero or negative time step, and for an aim that is not a number", () => {
    const camera = { x: 0.4, y: 0.4 };
    expect(advanceFollowCamera(camera, still(0.9, 0.9), 0)).toBe(camera);
    expect(advanceFollowCamera(camera, still(0.9, 0.9), -20)).toBe(camera);
    expect(advanceFollowCamera(camera, still(Number.NaN, 0.9), 40)).toBe(camera);
  });

  it("moves the same distance per unit time regardless of how the time is chopped up", () => {
    let coarse = { x: 0, y: 0 };
    coarse = advanceFollowCamera(coarse, still(1, 0), 160);
    let fine = { x: 0, y: 0 };
    for (let tick = 0; tick < 4; tick += 1) fine = advanceFollowCamera(fine, still(1, 0), 40);
    expect(fine.x).toBeCloseTo(coarse.x, 6);
  });
});
