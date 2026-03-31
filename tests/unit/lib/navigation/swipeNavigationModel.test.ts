/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRunwayPanelIndexes,
  resolveAdjacentIndexes,
  resolveNavigationDirection,
  resolveRunwayTranslatePercent,
} from '@/lib/navigation/swipeNavigationModel';

describe('swipeNavigationModel', () => {
  describe('resolveAdjacentIndexes', () => {
    it('returns previous, current and next indexes with wrapping', () => {
      // TAB_ROUTES has 6 entries; index 0 wraps to 5 as previous
      expect(resolveAdjacentIndexes(0)).toEqual([5, 0, 1]);
      expect(resolveAdjacentIndexes(1)).toEqual([0, 1, 2]);
      expect(resolveAdjacentIndexes(5)).toEqual([4, 5, 0]);
    });
  });

  describe('resolveNavigationDirection', () => {
    it('returns 0 for same index', () => {
      expect(resolveNavigationDirection(2, 2)).toBe(0);
    });

    it('returns 1 for forward navigation', () => {
      expect(resolveNavigationDirection(1, 2)).toBe(1);
    });

    it('returns -1 for backward navigation', () => {
      expect(resolveNavigationDirection(2, 1)).toBe(-1);
    });
  });

  describe('buildRunwayPanelIndexes', () => {
    it('returns [prev, cur, next] when no target is provided', () => {
      // direction = 0 path (lines 31-33)
      expect(buildRunwayPanelIndexes(1)).toEqual([0, 1, 2]);
    });

    it('returns [prev, cur, next] when target equals center', () => {
      // direction = 0 path via targetIndex === centerIndex (lines 31-33)
      expect(buildRunwayPanelIndexes(1, 1)).toEqual([0, 1, 2]);
    });

    it('returns [prev, cur, target] for forward navigation (direction === 1)', () => {
      // direction === 1 path (lines 38-40)
      expect(buildRunwayPanelIndexes(1, 2)).toEqual([0, 1, 2]);
    });

    it('returns [target, cur, next] for backward navigation (direction === -1)', () => {
      // direction === -1 path (lines 35-37)
      expect(buildRunwayPanelIndexes(2, 1)).toEqual([1, 2, 3]);
    });
  });

  describe('resolveRunwayTranslatePercent', () => {
    it('returns 0 for backward direction (-1)', () => {
      expect(resolveRunwayTranslatePercent(-1)).toBe(0);
    });

    it('returns -200/3 for forward direction (1)', () => {
      expect(resolveRunwayTranslatePercent(1)).toBeCloseTo(-(200 / 3));
    });

    it('returns -100/3 for neutral direction (0)', () => {
      expect(resolveRunwayTranslatePercent(0)).toBeCloseTo(-(100 / 3));
    });
  });
});
