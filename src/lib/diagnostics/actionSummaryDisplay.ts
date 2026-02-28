/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const formatActionSummaryOrigin = (origin?: string | null, originalOrigin?: string | null): string => {
  const normalizedOrigin = origin ?? 'unknown';
  if (!originalOrigin) return normalizedOrigin;
  return `${originalOrigin} → ${normalizedOrigin}`;
};

export const formatActionEffectTarget = (target?: string | null): string => (target ?? 'unknown').toLowerCase();
