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

export const resolveRunwayTranslatePercent = (direction: -1 | 0 | 1) => {
  if (direction === -1) return 0;
  if (direction === 1) return -(200 / 3);
  return -(100 / 3);
};
