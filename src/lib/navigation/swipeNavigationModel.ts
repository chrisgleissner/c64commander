/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ALL_TAB_INDEXES } from "@/lib/navigation/tabRoutes";

export type RunwayPanelIndexes = readonly [number, number, number];

const visibleSetFor = (index: number, visible: readonly number[]): readonly number[] =>
  visible.includes(index) ? visible : ALL_TAB_INDEXES;

export const resolveAdjacentIndexes = (
  index: number,
  visible: readonly number[] = ALL_TAB_INDEXES,
): RunwayPanelIndexes => {
  const set = visibleSetFor(index, visible);
  const position = set.indexOf(index);
  const count = set.length;
  return [set[(position - 1 + count) % count], index, set[(position + 1) % count]];
};

export const resolveNavigationDirection = (
  fromIndex: number,
  toIndex: number,
  visible: readonly number[] = ALL_TAB_INDEXES,
): -1 | 0 | 1 => {
  const set = visible.includes(fromIndex) && visible.includes(toIndex) ? visible : ALL_TAB_INDEXES;
  const count = set.length;
  const from = set.indexOf(fromIndex);
  const to = set.indexOf(toIndex);
  const forwardDistance = (to - from + count) % count;
  const backwardDistance = (from - to + count) % count;

  if (forwardDistance === 0) return 0;
  return forwardDistance <= backwardDistance ? 1 : -1;
};

export const buildRunwayPanelIndexes = (
  centerIndex: number,
  targetIndex?: number,
  visible: readonly number[] = ALL_TAB_INDEXES,
): RunwayPanelIndexes => {
  const [previousIndex, currentIndex, nextIndex] = resolveAdjacentIndexes(centerIndex, visible);

  if (targetIndex === undefined || targetIndex === centerIndex) {
    return [previousIndex, currentIndex, nextIndex];
  }

  const direction = resolveNavigationDirection(centerIndex, targetIndex, visible);
  if (direction === -1) {
    return [targetIndex, currentIndex, nextIndex];
  }
  if (direction === 1) {
    return [previousIndex, currentIndex, targetIndex];
  }
  return [previousIndex, currentIndex, nextIndex];
};

/**
 * The panel a drag is pulling into view, or null while the finger has not moved.
 * The track sits at -1/3 and a positive offset slides it right, which uncovers
 * the previous page on the left; a negative offset uncovers the next page.
 */
export const resolveDragRevealedIndex = (panelIndexes: RunwayPanelIndexes, dragOffsetPx: number): number | null => {
  if (dragOffsetPx > 0) return panelIndexes[0];
  if (dragOffsetPx < 0) return panelIndexes[2];
  return null;
};

/**
 * Adds a page index to the set of panels mounted for the current gesture,
 * preserving the existing array identity when nothing changes. Revealed panels
 * are never removed before the runway settles, so reversing a drag reveals the
 * other neighbour instead of unmounting and remounting the first one.
 */
export const addRevealedIndex = (revealed: readonly number[], index: number | null): readonly number[] => {
  if (index === null || revealed.includes(index)) return revealed;
  return [...revealed, index];
};

export const resolveRunwayTranslatePercent = (direction: -1 | 0 | 1) => {
  if (direction === -1) return 0;
  if (direction === 1) return -(200 / 3);
  return -(100 / 3);
};

/** The pages kept built, with `index` added: every page visited since launch, in tab order. */
export const rememberCachedPage = (cached: readonly number[], index: number): readonly number[] =>
  cached.includes(index) ? cached : [...cached, index].sort((a, b) => a - b);
