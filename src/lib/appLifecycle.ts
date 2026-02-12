/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type AppLifecycleState = 'foreground' | 'background' | 'locked' | 'unknown';

export const getLifecycleState = (): AppLifecycleState => {
  if (typeof document === 'undefined') return 'unknown';
  if (document.visibilityState === 'hidden' || document.hidden) return 'background';
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return 'locked';
  return 'foreground';
};
