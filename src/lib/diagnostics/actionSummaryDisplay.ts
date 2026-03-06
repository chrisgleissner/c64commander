/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { mapTargetDisplayLabel } from '@/lib/diagnostics/targetDisplayMapper';

export const formatActionSummaryOrigin = (
  origin?: string | null,
  originalOrigin?: string | null,
): string => {
  const normalizedOrigin = origin ?? 'unknown';
  if (!originalOrigin) return normalizedOrigin;
  return `${originalOrigin} → ${normalizedOrigin}`;
};

export const formatActionEffectTarget = (
  target?: string | null,
  product?: string | null,
): string => {
  return mapTargetDisplayLabel(target, product);
};

/**
 * Format an action duration for display. Output is deterministic, width-stable,
 * and guaranteed ≤ 6 characters with no trailing spaces.
 *
 * Rules:
 *   < 1 000 ms  → "{N}ms"     e.g. "0ms", "999ms"
 *   < 99.95 s   → "{N.N}s"    e.g. "1.0s", "99.9s"
 *   < 60 min    → "{M}m{S}s"  e.g. "1m40s", "59m59s"
 *   < 100 h     → "{H}h{M}m"  e.g. "1h0m", "99h59m"
 *   ≥ 100 h     → "{H}h"      e.g. "100h"
 */
export const formatTriggerDisplay = (trigger: {
  kind: string;
  name: string;
  intervalMs?: number | null;
}): string => {
  const suffix = trigger.name !== trigger.kind ? ` (${trigger.name})` : '';
  const interval =
    trigger.intervalMs != null ? ` · ${trigger.intervalMs}ms` : '';
  return `${trigger.kind}${suffix}${interval}`;
};

export const formatActionDuration = (
  durationMs: number | null | undefined,
): string => {
  if (
    durationMs === null ||
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  )
    return '—';

  if (durationMs < 999.5) {
    return `${Math.round(durationMs)}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 99.95) {
    return `${seconds.toFixed(1)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours >= 100) return `${hours}h`;
  return `${hours}h${remainingMinutes}m`;
};
