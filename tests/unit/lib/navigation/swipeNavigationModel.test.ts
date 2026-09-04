/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  addRevealedIndex,
  buildRunwayPanelIndexes,
  resolveAdjacentIndexes,
  resolveDragRevealedIndex,
  resolveNavigationDirection,
  resolveRunwayTranslatePercent,
} from "@/lib/navigation/swipeNavigationModel";

describe("swipeNavigationModel", () => {
  describe("resolveAdjacentIndexes", () => {
    it("returns previous, current and next indexes with wrapping", () => {
      // TAB_ROUTES has 6 entries; index 0 wraps to 5 as previous
      expect(resolveAdjacentIndexes(0)).toEqual([5, 0, 1]);
      expect(resolveAdjacentIndexes(1)).toEqual([0, 1, 2]);
      expect(resolveAdjacentIndexes(5)).toEqual([4, 5, 0]);
    });
  });

  describe("resolveNavigationDirection", () => {
    it("returns 0 for same index", () => {
      expect(resolveNavigationDirection(2, 2)).toBe(0);
    });

    it("returns 1 for forward navigation", () => {
      expect(resolveNavigationDirection(1, 2)).toBe(1);
    });

    it("returns -1 for backward navigation", () => {
      expect(resolveNavigationDirection(2, 1)).toBe(-1);
    });
  });

  describe("buildRunwayPanelIndexes", () => {
    it("returns [prev, cur, next] when no target is provided", () => {
      // direction = 0 path (lines 31-33)
      expect(buildRunwayPanelIndexes(1)).toEqual([0, 1, 2]);
    });

    it("returns [prev, cur, next] when target equals center", () => {
      // direction = 0 path via targetIndex === centerIndex (lines 31-33)
      expect(buildRunwayPanelIndexes(1, 1)).toEqual([0, 1, 2]);
    });

    it("returns [prev, cur, target] for forward navigation (direction === 1)", () => {
      // direction === 1 path (lines 38-40)
      expect(buildRunwayPanelIndexes(1, 2)).toEqual([0, 1, 2]);
    });

    it("returns [target, cur, next] for backward navigation (direction === -1)", () => {
      // direction === -1 path (lines 35-37)
      expect(buildRunwayPanelIndexes(2, 1)).toEqual([1, 2, 3]);
    });
  });

  describe("resolveRunwayTranslatePercent", () => {
    it("returns 0 for backward direction (-1)", () => {
      expect(resolveRunwayTranslatePercent(-1)).toBe(0);
    });

    it("returns -200/3 for forward direction (1)", () => {
      expect(resolveRunwayTranslatePercent(1)).toBeCloseTo(-(200 / 3));
    });

    it("returns -100/3 for neutral direction (0)", () => {
      expect(resolveRunwayTranslatePercent(0)).toBeCloseTo(-(100 / 3));
    });
  });

  // HARD27-038: these two decide which adjacent page the runway mounts.
  describe("resolveDragRevealedIndex", () => {
    const panels = [5, 0, 1] as const;

    it("reveals the previous page when the track is dragged right", () => {
      expect(resolveDragRevealedIndex(panels, 40)).toBe(5);
    });

    it("reveals the next page when the track is dragged left", () => {
      expect(resolveDragRevealedIndex(panels, -40)).toBe(1);
    });

    it("reveals nothing while the finger has not moved", () => {
      expect(resolveDragRevealedIndex(panels, 0)).toBeNull();
    });
  });

  describe("addRevealedIndex", () => {
    it("appends an index that is not already revealed", () => {
      expect(addRevealedIndex([1], 2)).toEqual([1, 2]);
    });

    it("keeps the same array when the index is already revealed", () => {
      const revealed = [1, 2];
      expect(addRevealedIndex(revealed, 2)).toBe(revealed);
    });

    it("keeps the same array for a null index", () => {
      const revealed = [1];
      expect(addRevealedIndex(revealed, null)).toBe(revealed);
    });
  });
});
