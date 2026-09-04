/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";

export type RunwayPanelIndexes = readonly [number, number, number];

export const resolveAdjacentIndexes = (index: number): RunwayPanelIndexes => {
  const count = TAB_ROUTES.length;
  return [(index - 1 + count) % count, index, (index + 1) % count];
};

export const resolveNavigationDirection = (fromIndex: number, toIndex: number): -1 | 0 | 1 => {
  const count = TAB_ROUTES.length;
  const forwardDistance = (toIndex - fromIndex + count) % count;
  const backwardDistance = (fromIndex - toIndex + count) % count;

  if (forwardDistance === 0) return 0;
  return forwardDistance <= backwardDistance ? 1 : -1;
};

export const buildRunwayPanelIndexes = (centerIndex: number, targetIndex?: number): RunwayPanelIndexes => {
  const [previousIndex, currentIndex, nextIndex] = resolveAdjacentIndexes(centerIndex);

  if (targetIndex === undefined || targetIndex === centerIndex) {
    return [previousIndex, currentIndex, nextIndex];
  }

  const direction = resolveNavigationDirection(centerIndex, targetIndex);
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
