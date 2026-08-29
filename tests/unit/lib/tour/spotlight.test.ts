/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { captionPlacement, scrimRects, unionRect } from "@/lib/tour/spotlight";

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

describe("captionPlacement", () => {
  it("puts the caption below a hole near the top", () => {
    expect(captionPlacement({ top: 20, left: 0, width: 320, height: 40 }, 427)).toBe("bottom");
  });

  it("puts the caption above a hole near the bottom, so it never covers what it describes", () => {
    expect(captionPlacement({ top: 360, left: 0, width: 320, height: 40 }, 427)).toBe("top");
  });

  it("puts a caption with no hole at the bottom", () => {
    expect(captionPlacement(null, 427)).toBe("bottom");
  });
});
