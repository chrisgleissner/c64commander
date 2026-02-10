/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const DIAGNOSTICS_TIMESTAMP_PLACEHOLDER = '--:--:--.---';

export const formatLocalTime = (value?: string | number | Date | null) => {
  if (value === null || value === undefined) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
};

export const formatDiagnosticsTimestamp = (value?: string | number | Date | null) => {
  const formatted = formatLocalTime(value);
  return formatted === '—' ? DIAGNOSTICS_TIMESTAMP_PLACEHOLDER : formatted;
};

export const splitDiagnosticsTimestamp = (value?: string | number | Date | null) => {
  const formatted = formatDiagnosticsTimestamp(value);
  const [time, millis = '---'] = formatted.split('.');
  return { formatted, time, millis };
};
