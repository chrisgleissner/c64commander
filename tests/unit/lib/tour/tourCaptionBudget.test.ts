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
 * still showing behind it. On the narrowest screen the app supports, 320 x 427 CSS px with the
 * Pixel's system bars, a caption of a progress line, a one-line title, a three-line body and a row
 * of buttons left 36% of the screen showing. The acceptance bar is at least half.
 *
 * The compact profile renders the body at 18 px, which fits about 32 characters on a line at that
 * width. Two lines and a one-line title beside the step count left 54% showing when measured on the
 * Pixel 4 at that geometry. A character budget is coarse, but it needs no browser to check; the
 * on-device measurement is what confirms it in pixels.
 */

import { describe, expect, it } from "vitest";
import { TOUR_STEPS, stepBody, type TourContext } from "@/lib/tour/steps";

/** Two lines of body at 320 CSS px. */
const MAX_BODY_CHARS = 64;

/** One line beside the step count. */
const MAX_TITLE_CHARS = 20;

const CONTEXTS: readonly TourContext[] = [{ hvscInstalled: false }, { hvscInstalled: true }];

const everyBody = () =>
  TOUR_STEPS.flatMap((step) => [
    ...CONTEXTS.map((context) => ({ id: step.id, text: stepBody(step, context) })),
    ...(step.unavailableBody ? [{ id: `${step.id} (unavailable)`, text: step.unavailableBody }] : []),
  ]);

describe("the tour has to leave the app visible behind it", () => {
  it("keeps every caption body, in every context, inside the two-line budget", () => {
    const tooLong = everyBody()
      .filter((body) => body.text.length > MAX_BODY_CHARS)
      .map((body) => `${body.id}: ${body.text.length} chars`);
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
    everyBody().forEach((body) => expect(body.text.trim().length, `${body.id} has no body`).toBeGreaterThan(20));
    TOUR_STEPS.forEach((step) => expect(step.title.trim().length, `${step.id} has no title`).toBeGreaterThan(3));
  });

  it("uses American spelling, like the rest of the app and the machine itself", () => {
    const british = /\b(colour|behaviour|favourite|centre|grey|organise|recognise)\b/i;
    const found = [...everyBody().map((body) => body.text), ...TOUR_STEPS.map((step) => step.title)].filter((text) =>
      british.test(text),
    );
    expect(found).toEqual([]);
  });
});
