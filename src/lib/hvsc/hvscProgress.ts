/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const calculateHvscProgress = (
  processedCount?: number | null,
  totalCount?: number | null,
  explicitPercent?: number | null,
) => {
  if (typeof explicitPercent === 'number') {
    return Math.max(0, Math.min(100, Math.floor(explicitPercent)));
  }
  if (processedCount === null || processedCount === undefined) return null;
  if (totalCount === null || totalCount === undefined || totalCount <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((processedCount / totalCount) * 100)));
};
