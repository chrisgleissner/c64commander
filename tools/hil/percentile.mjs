/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Nearest-rank percentile, the rule the search-latency gate reports against.
 *
 * It lives here rather than beside the probe in src because the gate is Node and the probe is
 * TypeScript running in the WebView: the gate cannot import the app's copy, and while there were
 * two copies the tested one was not the one deciding whether a build passed.
 *
 * @param {readonly number[]} values
 * @param {number} fraction 0..1
 * @returns {number | null} null for an empty sample set
 */
export const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
};
