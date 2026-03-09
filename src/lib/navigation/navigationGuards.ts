/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type NavigationGuard = () => boolean;

const navigationGuards = new Set<NavigationGuard>();

export const registerNavigationGuard = (guard: NavigationGuard) => {
  navigationGuards.add(guard);
  return () => {
    navigationGuards.delete(guard);
  };
};

export const confirmNavigation = () => {
  for (const guard of navigationGuards) {
    if (!guard()) {
      return false;
    }
  }
  return true;
};
