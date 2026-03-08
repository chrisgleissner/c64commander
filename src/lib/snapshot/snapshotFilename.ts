/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SnapshotType } from "./snapshotTypes";
import { SNAPSHOT_TYPE_LIST } from "./snapshotTypes";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Formats a Date as `YYYY-MM-DD HH:MM:SS` (local time) for user display.
 * All timestamps shown to users use this format.
 */
export const formatDisplayTimestamp = (date: Date): string => {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
};

/**
 * Formats a Date as `YYYYMMDD-HHMMSS` (local time) for use in filenames.
 */
export const formatFileTimestamp = (date: Date): string => {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
};

/**
 * Builds the canonical snapshot filename.
 * Format: `c64-{typePrefix}-{YYYYMMDD}-{HHMMSS}.c64snap`
 */
export const buildSnapshotFileName = (type: SnapshotType, date = new Date()): string => {
  const config = SNAPSHOT_TYPE_LIST.find((c) => c.type === type);
  const prefix = config?.filePrefix ?? "custom";
  return `c64-${prefix}-${formatFileTimestamp(date)}.c64snap`;
};
