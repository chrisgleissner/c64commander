/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** What a details row shows when it has no value to show. */
export const UNKNOWN_VALUE = "—";

const BYTE_UNITS = ["B", "KB", "MB", "GB"];

/**
 * Scale a byte count to the largest unit that keeps it under 1024.
 *
 * One decimal place, dropped once the number reaches 10 or the unit is still
 * bytes, so a size stays about three digits wide however large it is and no row
 * ever reads "1.0 B".
 *
 * Callers decide for themselves what an absent or zero size looks like: the two
 * surfaces that show sizes disagree on zero on purpose, and that policy belongs
 * with each of them rather than here.
 */
export const formatByteSize = (value: number) => {
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${BYTE_UNITS[unitIndex]}`;
};

/** Format an ISO-ish date string in the viewer's locale, or `—` if unusable. */
export const formatDetailDate = (value?: string | null) => {
  if (!value) return UNKNOWN_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return UNKNOWN_VALUE;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
};
