/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How much of a small screen the tour is allowed to cover.
 *
 * The tour spotlights the real app and captions it, so the caption is worth only as much as the app
 * still showing behind it. Measured on the narrowest screen the app supports, 320 x 427 CSS px: the
 * caption panel took between 66% and 81% of the height, and on the worst step nothing of the page
 * underneath was visible at all. The bodies were 119 to 165 characters, which is five or six lines
 * at that width.
 *
 * A character budget is what holds that. It is coarse — a proportional font makes any count
 * approximate — but it is the thing that regressed, it needs no browser to check, and the on-device
 * measurement in `tools/hil/release_sweep_hil.mjs` is what confirms the result in pixels.
 */

import { describe, expect, it } from "vitest";
import { TOUR_STEPS } from "@/lib/tour/steps";

/** Two lines of body at 320 CSS px, with room for the longest words this app uses. */
const MAX_BODY_CHARS = 95;

/** A title is one line. Anything longer wraps and costs as much as a line of body. */
const MAX_TITLE_CHARS = 34;

describe("the tour has to leave the app visible behind it", () => {
  it("keeps every caption body inside the two-line budget", () => {
    const tooLong = TOUR_STEPS.filter((step) => step.body.length > MAX_BODY_CHARS).map(
      (step) => `${step.id}: ${step.body.length} chars`,
    );
    expect(tooLong, `over ${MAX_BODY_CHARS} characters`).toEqual([]);
  });

  it("keeps every caption title on one line", () => {
    const tooLong = TOUR_STEPS.filter((step) => step.title.length > MAX_TITLE_CHARS).map(
      (step) => `${step.id}: ${step.title.length} chars`,
    );
    expect(tooLong, `over ${MAX_TITLE_CHARS} characters`).toEqual([]);
  });

  /*
   * The budget is worth nothing if the steps stop being checked against it, which is what happens
   * when a list is filtered down to nothing and the empty result passes.
   */
  it("checked every step the tour has", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(13);
    TOUR_STEPS.forEach((step) => {
      expect(step.body.trim().length, `${step.id} has no body`).toBeGreaterThan(20);
      expect(step.title.trim().length, `${step.id} has no title`).toBeGreaterThan(3);
    });
  });
});
