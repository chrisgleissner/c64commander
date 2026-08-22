/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The input-affinity cue. The property that has to hold is not "it helps" but "it cannot hurt":
 * with no input, with input the game ignores, and with a side-scroller that moves the world
 * instead of the player, the cue must contribute exactly nothing. Those are the tests that come
 * first below; the ones showing it works at all come after.
 */

import { describe, expect, it } from "vitest";
import { affinityOf, InputAffinity, joystickVector } from "@/lib/streams/inputAffinity";

/** Hold one direction from `fromMs` for `durationMs`, then release. */
const hold = (affinity: InputAffinity, dx: number, dy: number, fromMs: number, durationMs: number): number => {
  affinity.assert(dx, dy, fromMs);
  affinity.assert(0, 0, fromMs + durationMs);
  return fromMs + durationMs;
};

describe("InputAffinity — the cases where it must contribute nothing", () => {
  it("says nothing when the player is on a real joystick and the app asserts no input", () => {
    const affinity = new InputAffinity();
    expect(affinity.expected(1000, 1040).weight).toBe(0);
    expect(affinity.reliability).toBe(0);
    expect(affinity.bonusScale).toBe(0);
  });

  it("scores zero for a candidate when there is no expectation to compare it with", () => {
    const affinity = new InputAffinity();
    expect(affinityOf(10, 0, affinity.expected(1000, 1040))).toBe(0);
  });

  it("has no reliability until it has seen enough of the game's answers", () => {
    const affinity = new InputAffinity();
    for (let i = 0; i < 6; i += 1) {
      const at = 1000 + i * 100;
      hold(affinity, 1, 0, at, 100);
      affinity.observe(6, 0, 40, affinity.expected(at + 200, at + 240));
    }
    expect(affinity.reliability).toBe(0);
  });

  it("gives no bonus to a background that scrolls against the stick, as a side-scroller does", () => {
    const affinity = new InputAffinity();
    hold(affinity, 1, 0, 1000, 400);
    const expected = affinity.expected(1200, 1240);
    // Press right, the world scrolls left: the naive correlation would point straight at it.
    expect(affinityOf(-8, 0, expected)).toBe(0);
  });

  it("stays at zero reliability in a side-scroller, because the player never moves on screen", () => {
    const affinity = new InputAffinity();
    for (let i = 0; i < 40; i += 1) {
      const at = 1000 + i * 100;
      hold(affinity, 1, 0, at, 100);
      // The player is pinned at the centre of the screen; only the world moved.
      affinity.observe(0.2, 0, 40, affinity.expected(at + 200, at + 240));
    }
    expect(affinity.reliability).toBe(0);
    expect(affinity.bonusScale).toBe(0);
  });

  it("drives itself to zero in a game that does not answer the stick with position", () => {
    const affinity = new InputAffinity();
    // Asteroids: "right" rotates the ship, so the direction it travels is unrelated to the stick.
    const directions = [
      [8, 0],
      [0, 9],
      [-7, 2],
      [1, -8],
      [6, 6],
      [-6, -5],
    ];
    for (let i = 0; i < 60; i += 1) {
      const at = 1000 + i * 100;
      hold(affinity, 1, 0, at, 100);
      const [dx, dy] = directions[i % directions.length];
      affinity.observe(dx, dy, 40, affinity.expected(at + 200, at + 240));
    }
    expect(affinity.reliability).toBeLessThan(0.2);
  });
});

describe("InputAffinity — what it says when the game does answer the stick", () => {
  it("expects motion in the direction held, with the machine's lag allowed for", () => {
    const affinity = new InputAffinity();
    hold(affinity, 1, 0, 1000, 400);
    const expected = affinity.expected(1200, 1240);
    // Under 1 rather than at it: the lag window reaches back past the moment of the press, and
    // coverage is honest about the part of it that predates the assertion.
    expect(expected.weight).toBeGreaterThan(0.7);
    expect(expected.dx).toBeGreaterThan(0);
    expect(expected.dy).toBe(0);
  });

  it("does not expect anything from an assertion that is still in flight to the machine", () => {
    const affinity = new InputAffinity();
    affinity.assert(1, 0, 1000);
    // 20 ms after the press: sooner than the machine could have answered it.
    expect(affinity.expected(1000, 1020).weight).toBe(0);
  });

  it("averages a direction over the time it was actually held", () => {
    const affinity = new InputAffinity();
    affinity.assert(1, 0, 1000); // right, for 300 ms
    affinity.assert(0, 1, 1300); // then down, for 100 ms
    affinity.assert(0, 0, 1400);
    const expected = affinity.expected(1100, 1500);
    expect(expected.dx).toBeGreaterThan(expected.dy);
    expect(expected.dy).toBeGreaterThan(0);
  });

  it("rewards the candidate that moved the way the stick asked and not the one that did not", () => {
    const affinity = new InputAffinity();
    hold(affinity, 1, 0, 1000, 400);
    const expected = affinity.expected(1200, 1240);
    const player = affinityOf(9, 1, expected);
    const drifter = affinityOf(0, 9, expected);
    const enemy = affinityOf(-9, 0, expected);
    expect(player).toBeGreaterThan(0.7);
    expect(drifter).toBeLessThan(0.2);
    expect(enemy).toBe(0);
  });

  it("earns a bonus once the game has answered the stick consistently", () => {
    const affinity = new InputAffinity();
    for (let i = 0; i < 60; i += 1) {
      const at = 1000 + i * 100;
      hold(affinity, 1, 0, at, 100);
      affinity.observe(7, 0, 40, affinity.expected(at + 200, at + 240));
    }
    expect(affinity.reliability).toBeGreaterThan(0.8);
    expect(affinity.bonusScale).toBeGreaterThan(0);
    expect(affinity.bonusScale).toBeLessThanOrEqual(0.08);
  });

  it("keeps the bonus small enough that it cannot outvote the fitted cues", () => {
    const affinity = new InputAffinity({ minSamples: 1 });
    for (let i = 0; i < 200; i += 1) {
      const at = 1000 + i * 100;
      hold(affinity, 1, 0, at, 100);
      affinity.observe(7, 0, 40, affinity.expected(at + 200, at + 240));
    }
    // `acceptScore` is 0.46 and `minAppearance` 0.35: a full-strength bonus moves neither bar.
    expect(affinity.bonusScale).toBeLessThan(0.1);
  });

  it("forgets everything on reset, so a new lock is a new question", () => {
    const affinity = new InputAffinity({ minSamples: 1 });
    hold(affinity, 1, 0, 1000, 400);
    affinity.observe(7, 0, 40, affinity.expected(1200, 1240));
    expect(affinity.bonusScale).toBeGreaterThan(0);
    affinity.reset();
    expect(affinity.reliability).toBe(0);
    expect(affinity.expected(1200, 1240).weight).toBe(0);
  });

  it("keeps answering after more assertions than its history holds", () => {
    const affinity = new InputAffinity();
    let at = 1000;
    for (let i = 0; i < 500; i += 1) {
      at = hold(affinity, i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 0 : 1, at, 100);
      affinity.prune(at);
    }
    expect(affinity.expected(at - 100, at - 60).weight).toBeGreaterThanOrEqual(0);
  });

  it("keeps the assertion still in force when it prunes the ones behind it", () => {
    const affinity = new InputAffinity();
    affinity.assert(1, 0, 1000);
    affinity.prune(5000);
    // Held since 1000 and never released: at 5000 it is still what the player is asking for.
    expect(affinity.expected(4800, 4840).dx).toBeGreaterThan(0);
  });
});

describe("joystickVector", () => {
  it("maps the stick to screen axes, with up towards the top of the picture", () => {
    expect(joystickVector({ up: true })).toEqual({ dx: 0, dy: -1 });
    expect(joystickVector({ down: true, right: true })).toEqual({ dx: 1, dy: 1 });
    expect(joystickVector({})).toEqual({ dx: 0, dy: 0 });
  });

  it("reads opposite directions held together as no direction at all", () => {
    expect(joystickVector({ left: true, right: true })).toEqual({ dx: 0, dy: 0 });
  });
});
