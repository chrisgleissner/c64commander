/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type PlaylistTotals = {
  total?: number;
  remaining?: number;
};

export const calculatePlaylistTotals = (
  durations: Array<number | undefined>,
  playedMs: number,
): PlaylistTotals => {
  if (!durations.length) return { total: undefined, remaining: undefined };
  const allKnown = durations.every((value) => value !== undefined);
  if (!allKnown) return { total: undefined, remaining: undefined };
  const total = durations.reduce((sum, value) => sum + (value ?? 0), 0);
  const remaining = Math.max(0, total - Math.max(0, playedMs));
  return { total, remaining };
};
