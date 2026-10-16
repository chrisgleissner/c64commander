/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { SCROLL_INDICATOR_MIN_THUMB_PX, computeScrollIndicatorThumb } from "@/lib/scroll/scrollIndicatorGeometry";

describe("computeScrollIndicatorThumb", () => {
  it("is hidden when the content fits, including sub-pixel rounding", () => {
    expect(computeScrollIndicatorThumb({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 }, 392).visible).toBe(
      false,
    );
    expect(computeScrollIndicatorThumb({ scrollTop: 0, scrollHeight: 401, clientHeight: 400 }, 392).visible).toBe(
      false,
    );
    expect(computeScrollIndicatorThumb({ scrollTop: 0, scrollHeight: 800, clientHeight: 0 }, 392).visible).toBe(false);
    expect(computeScrollIndicatorThumb({ scrollTop: 0, scrollHeight: 800, clientHeight: 400 }, 0).visible).toBe(false);
  });

  it("sizes the thumb as the share of the content the viewport shows", () => {
    const thumb = computeScrollIndicatorThumb({ scrollTop: 0, scrollHeight: 1600, clientHeight: 400 }, 392);
    expect(thumb.visible).toBe(true);
    expect(thumb.thumbHeight).toBeCloseTo(98);
  });

  it("never draws a thumb shorter than the minimum", () => {
    const thumb = computeScrollIndicatorThumb({ scrollTop: 0, scrollHeight: 400_000, clientHeight: 400 }, 392);
    expect(thumb.thumbHeight).toBe(SCROLL_INDICATOR_MIN_THUMB_PX);
  });

  it("places the thumb by how far through the scroll range the viewport is", () => {
    const metrics = { scrollHeight: 1600, clientHeight: 400 };
    expect(computeScrollIndicatorThumb({ ...metrics, scrollTop: 0 }, 392).thumbOffset).toBe(0);
    expect(computeScrollIndicatorThumb({ ...metrics, scrollTop: 600 }, 392).thumbOffset).toBeCloseTo((392 - 98) / 2);
    expect(computeScrollIndicatorThumb({ ...metrics, scrollTop: 1200 }, 392).thumbOffset).toBeCloseTo(392 - 98);
  });

  it("keeps the thumb on the track during overscroll", () => {
    const metrics = { scrollHeight: 1600, clientHeight: 400 };
    expect(computeScrollIndicatorThumb({ ...metrics, scrollTop: -50 }, 392).thumbOffset).toBe(0);
    expect(computeScrollIndicatorThumb({ ...metrics, scrollTop: 1300 }, 392).thumbOffset).toBeCloseTo(392 - 98);
  });
});
