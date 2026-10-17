/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const formatTickMinute = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
};

// Buckets are shorter than a minute, so several share one HH:MM label; keep only the first of each.
export const uniqueMinuteTicks = (times: readonly string[]): string[] => {
  const seen = new Set<string>();
  return times.filter((time) => {
    const label = formatTickMinute(time);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
};
