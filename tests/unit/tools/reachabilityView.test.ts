/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { intersectScrollBoxes, stopIsInView, usableViewHeight } from "../../../tools/hil/reachability_view.mjs";

describe("keypad reachability view criterion", () => {
  const view = { width: 320, height: 427 };
  const box = { top: 58, bottom: 382 };
  const guidance = 31;
  const usable = usableViewHeight(view.height, 324, 8, guidance + 8);
  const card = (top: number, bottom: number) => ({ top, bottom, left: 8, right: 312 });
  const inView = (rect: ReturnType<typeof card>) => stopIsInView(rect, view.width, view.height, usable, box, guidance);

  it("takes the scroll box of a page with sticky chrome, not the window, as the usable height, less the scroll margins", () => {
    expect(usableViewHeight(427, 324, 8, 39)).toBe(277);
    expect(usableViewHeight(427, null, 8, 27)).toBe(392);
  });

  it("accepts a card taller than the scroll box whose start is on screen", () => {
    expect(inView(card(58, 441))).toBe(true);
    expect(
      stopIsInView(card(58, 441), view.width, view.height, usableViewHeight(view.height, null, 8, 27), null, 0),
    ).toBe(false);
  });

  it("accepts a card only a few pixels shorter than the scroll box", () => {
    expect(inView(card(58, 374))).toBe(true);
    expect(inView(card(58, 381))).toBe(true);
  });

  it("requires a meaningful part of a tall card to show above the guidance bar", () => {
    expect(inView(card(320, 760))).toBe(true);
    expect(inView(card(340, 760))).toBe(false);
    expect(inView(card(381, 760))).toBe(false);
    expect(inView(card(426, 800))).toBe(false);
  });

  it("reports a card whose start is above the box or off to one side", () => {
    expect(inView(card(-40, 400))).toBe(false);
    expect(inView(card(40, 400))).toBe(false);
    expect(inView({ top: 60, bottom: 400, left: 8, right: 340 })).toBe(false);
  });

  it("measures a list that scrolls inside the page by the part of the page's box it shares", () => {
    expect(intersectScrollBoxes([], 427)).toBeNull();
    expect(intersectScrollBoxes([{ top: 58, bottom: 382 }], 427)).toEqual({ top: 58, bottom: 382 });
    expect(
      intersectScrollBoxes(
        [
          { top: 200, bottom: 500 },
          { top: 58, bottom: 382 },
        ],
        427,
      ),
    ).toEqual({ top: 200, bottom: 382 });
    const nested = intersectScrollBoxes(
      [
        { top: 200, bottom: 500 },
        { top: 58, bottom: 382 },
      ],
      427,
    )!;
    expect(stopIsInView(card(300, 800), view.width, view.height, 100, nested, guidance)).toBe(true);
    expect(stopIsInView(card(360, 800), view.width, view.height, 100, nested, guidance)).toBe(false);
  });
});
