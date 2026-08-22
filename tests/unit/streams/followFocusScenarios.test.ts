/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The follow-focus tracker against whole synthetic games, on the HELD-OUT seeds.
 *
 * `scripts/tune-follow-focus.ts` fitted the tracker's defaults by coordinate descent on seeds
 * 1-3 and chose where to stop using seeds 101-103. This runs the same scoring on the held-out
 * seeds and fails if it regresses, which is what turns that afternoon's tuning into a committed
 * result rather than a note in a document.
 *
 * The floors are set below the measured numbers by a deliberate margin. They are a regression
 * gate, not a target: a change that improves the tracker should raise them, and a change that
 * quietly gives up a tenth of the score should fail here.
 */

import { describe, expect, it } from "vitest";
import { evaluateSuite } from "../../helpers/followFocusEval";
import { SCENARIO_KINDS } from "../../helpers/gameScenarios";

/** The seeds the search never saw. Changing these invalidates the comparison. */
const VALIDATION_SEEDS = [101, 102, 103];

describe("follow-focus against synthetic games (held-out seeds)", () => {
  const suite = evaluateSuite(VALIDATION_SEEDS);

  it("scores at least as well as the tuned result", () => {
    // Measured at the tuned defaults: score 0.51, on-target 0.67, confidently wrong 0.09.
    expect(suite.score).toBeGreaterThan(0.45);
    expect(suite.onTarget).toBeGreaterThan(0.62);
    expect(suite.hijacked).toBeLessThan(0.12);
  });

  it("arrives quickly after a respawn or a room change", () => {
    // Measured: a median of 1 frame, because a scene cut goes straight to a whole-frame search
    // rather than coasting on a prediction the teleport already invalidated.
    expect(suite.medianRelockFrames).toBeLessThanOrEqual(6);
  });

  it("stays inside the tick budget it was scored under", () => {
    // 25 Hz locked, 50 Hz while recovering. A change that buys accuracy by tracking every frame
    // has moved cost onto the JS thread that shares it with decode and the UI.
    expect(suite.updatesPerSecond).toBeLessThan(40);
  });

  it("covers every scenario, so a kind cannot be dropped without the gate noticing", () => {
    expect(suite.scenarios).toHaveLength(SCENARIO_KINDS.length * VALIDATION_SEEDS.length);
    for (const kind of SCENARIO_KINDS) {
      expect(suite.scenarios.some((scenario) => scenario.name.startsWith(`${kind}#`))).toBe(true);
    }
  });

  it("never follows the wrong sprite confidently in the ordinary scenarios", () => {
    // Platformer, powerup and maze are the everyday cases — walking, flashing, and going behind
    // scenery. Following something else there is not a hard case being hard, it is a defect.
    const ordinary = suite.scenarios.filter((scenario) => /^(platformer|powerup|maze)#/.test(scenario.name));
    for (const scenario of ordinary) {
      expect(scenario.hijacked).toBeLessThan(0.05);
      expect(scenario.onTarget).toBeGreaterThan(0.7);
    }
  });
});
