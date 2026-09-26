/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

/** Two units at most, the larger first: "56s", "16m 56s", "10h 16m", "2d 3h". */
export const formatElapsedSeconds = (elapsedSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(elapsedSeconds));
  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const hours = Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % SECONDS_PER_MINUTE}s`;
  return `${seconds}s`;
};

export const formatElapsedAgo = (prefix: string, timestampMs: number | null, nowMs: number = Date.now()): string => {
  if (timestampMs === null || Number.isNaN(timestampMs)) return `${prefix} -`;
  return `${prefix} ${formatElapsedSeconds((nowMs - timestampMs) / 1000)} ago`;
};
