/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  SPOTLIGHT_MARGIN,
  captionPlacement,
  freeBand,
  scrimRects,
  spotlightScrollDelta,
  unionRect,
  type SpotlightFrame,
} from "@/lib/tour/spotlight";

const VIEWPORT = { width: 320, height: 427 };

describe("unionRect", () => {
  it("is null with nothing to spotlight, which is what degrades a step to its caption", () => {
    expect(unionRect([])).toBeNull();
  });

  it("pads a single rect", () => {
    expect(unionRect([{ top: 100, left: 20, width: 60, height: 40 }], 6)).toEqual({
      top: 94,
      left: 14,
      width: 72,
      height: 52,
    });
  });

  /*
   * The reason `testIds` is a list: step 4 spotlights both the Resume and the Recent tile, and the
   * hole has to enclose them rather than pick one.
   */
  it("encloses two anchors side by side", () => {
    const hole = unionRect(
      [
        { top: 100, left: 10, width: 50, height: 40 },
        { top: 100, left: 80, width: 50, height: 40 },
      ],
      0,
    );
    expect(hole).toEqual({ top: 100, left: 10, width: 120, height: 40 });
  });

  it("encloses two anchors on different rows", () => {
    const hole = unionRect(
      [
        { top: 100, left: 10, width: 50, height: 40 },
        { top: 160, left: 10, width: 50, height: 40 },
      ],
      0,
    );
    expect(hole).toEqual({ top: 100, left: 10, width: 50, height: 100 });
  });
});

describe("scrimRects", () => {
  /*
   * Four rectangles around the hole rather than an SVG mask: sharper at DPR 1.5, and no compositing
   * layer.
   */
  it("draws four pieces around a hole in the middle", () => {
    const pieces = scrimRects({ top: 100, left: 40, width: 100, height: 60 }, VIEWPORT);
    expect(pieces).toHaveLength(4);
    expect(pieces[0]).toEqual({ top: 0, left: 0, width: 320, height: 100 });
    expect(pieces[1]).toEqual({ top: 160, left: 0, width: 320, height: 267 });
    expect(pieces[2]).toEqual({ top: 100, left: 0, width: 40, height: 60 });
    expect(pieces[3]).toEqual({ top: 100, left: 140, width: 180, height: 60 });
  });

  it("leaves no gap and no overlap: the four pieces plus the hole tile the viewport", () => {
    const hole = { top: 100, left: 40, width: 100, height: 60 };
    const covered =
      scrimRects(hole, VIEWPORT).reduce((total, piece) => total + piece.width * piece.height, 0) +
      hole.width * hole.height;
    expect(covered).toBe(VIEWPORT.width * VIEWPORT.height);
  });

  it("drops a zero-area piece rather than painting an empty box", () => {
    const pieces = scrimRects({ top: 0, left: 0, width: 320, height: 60 }, VIEWPORT);
    expect(pieces.every((piece) => piece.width > 0 && piece.height > 0)).toBe(true);
    expect(pieces).toHaveLength(1);
  });

  it("covers the whole viewport when a step has no anchor", () => {
    expect(scrimRects(null, VIEWPORT)).toEqual([{ top: 0, left: 0, width: 320, height: 427 }]);
  });

  it("clamps a hole that runs off the bottom", () => {
    const pieces = scrimRects({ top: 400, left: 0, width: 320, height: 200 }, VIEWPORT);
    expect(pieces.every((piece) => piece.top + piece.height <= VIEWPORT.height)).toBe(true);
  });
});

/*
 * The numbers are the ones measured on the smallest supported screen, 320 x 427 CSS px, with the
 * Pixel's 30 px status bar and 48 px navigation bar and a caption that is 273 px tall.
 */
const SMALL: SpotlightFrame = { viewportHeight: 427, captionHeight: 273, insetTop: 30, insetBottom: 48 };
const rect = (top: number, height: number) => ({ top, left: 0, width: 320, height });

describe("captionPlacement", () => {
  it("puts the caption below a hole near the top", () => {
    expect(captionPlacement(rect(20, 40), SMALL)).toBe("bottom");
  });

  it("puts the caption above a hole near the bottom, so it never covers what it describes", () => {
    expect(captionPlacement(rect(360, 40), SMALL)).toBe("top");
  });

  it("puts a caption with no hole at the bottom", () => {
    expect(captionPlacement(null, SMALL)).toBe("bottom");
  });

  it("puts the caption on the edge that leaves more of the hole in view", () => {
    // Below a 150 px caption at the bottom, 127 px of this hole show; above one at the top, 150.
    expect(captionPlacement(rect(150, 150), { ...SMALL, captionHeight: 150 })).toBe("top");
  });

  it("keeps the bottom on a tie", () => {
    expect(captionPlacement(rect(0, 427), { ...SMALL, captionHeight: 100, insetTop: 0, insetBottom: 0 })).toBe(
      "bottom",
    );
  });
});

describe("freeBand", () => {
  it("does not take the inset away twice on the caption's own side", () => {
    expect(freeBand("bottom", SMALL)).toEqual({ top: 30, bottom: 154 });
    expect(freeBand("top", SMALL)).toEqual({ top: 273, bottom: 379 });
  });
});

describe("spotlightScrollDelta", () => {
  const frame: SpotlightFrame = { ...SMALL, captionHeight: 206 };

  it("leaves a hole that already fits where it is", () => {
    expect(spotlightScrollDelta(rect(81, 56), "bottom", frame)).toBe(0);
  });

  it("lifts a hole the bottom caption would cover into the band above it", () => {
    // Band 30..221, less the 8 px margin: the hole's bottom has to come up to 213.
    expect(spotlightScrollDelta(rect(173, 118), "bottom", frame)).toBe(173 + 118 - 213);
  });

  it("brings a hole above the band down into it", () => {
    expect(spotlightScrollDelta(rect(5, 40), "bottom", frame)).toBe(5 - 38);
  });

  it("shows where a hole taller than the band starts", () => {
    expect(spotlightScrollDelta(rect(300, 900), "top", frame)).toBe(300 - (206 + SPOTLIGHT_MARGIN));
  });

  it("aligns inside the scroll area, not under the app bar above it", () => {
    const clip = { top: 87, bottom: 337 };
    expect(spotlightScrollDelta(rect(173, 118), "bottom", { ...frame, clip })).toBe(173 - (87 + SPOTLIGHT_MARGIN));
  });

  it("does nothing without a hole", () => {
    expect(spotlightScrollDelta(null, "bottom", frame)).toBe(0);
  });
});
