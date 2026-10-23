/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { stopIsInView, usableViewHeight } from "../../../tools/hil/reachability_view.mjs";

describe("keypad reachability view criterion", () => {
  const window = { width: 320, height: 427 };
  const box = { top: 58, bottom: 382 };

  it("takes the scroll box of a page with sticky chrome, not the window, as the usable height", () => {
    expect(usableViewHeight(427, 324, 8, 27)).toBe(324);
    expect(usableViewHeight(427, null, 8, 27)).toBe(392);
  });

  it("accepts a card taller than the scroll box whose start is on screen", () => {
    const card = { top: 58, bottom: 441, left: 8, right: 312 };
    const usable = usableViewHeight(window.height, 324, 8, 27);
    expect(stopIsInView(card, window.width, window.height, usable, box)).toBe(true);
    expect(stopIsInView(card, window.width, window.height, usableViewHeight(window.height, null, 8, 27), null)).toBe(
      false,
    );
  });

  it("still reports a card that would fit its scroll box but sits below the window", () => {
    const card = { top: 380, bottom: 470, left: 8, right: 312 };
    const usable = usableViewHeight(window.height, 324, 8, 27);
    expect(stopIsInView(card, window.width, window.height, usable, box)).toBe(false);
  });

  it("reports a tall card whose start is behind the bars below the scroll box", () => {
    const usable = usableViewHeight(window.height, 324, 8, 27);
    expect(stopIsInView({ top: 381, bottom: 760, left: 8, right: 312 }, window.width, window.height, usable, box)).toBe(
      true,
    );
    expect(stopIsInView({ top: 400, bottom: 760, left: 8, right: 312 }, window.width, window.height, usable, box)).toBe(
      false,
    );
    expect(stopIsInView({ top: 426, bottom: 800, left: 8, right: 312 }, window.width, window.height, usable, box)).toBe(
      false,
    );
  });

  it("reports a card whose start is above the window or off to one side", () => {
    const usable = usableViewHeight(window.height, 324, 8, 27);
    expect(stopIsInView({ top: -40, bottom: 400, left: 8, right: 312 }, window.width, window.height, usable, box)).toBe(
      false,
    );
    expect(stopIsInView({ top: 60, bottom: 400, left: 8, right: 340 }, window.width, window.height, usable, box)).toBe(
      false,
    );
  });
});
