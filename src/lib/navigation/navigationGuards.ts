/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

type NavigationGuard = () => boolean;

/** Narrower than `NavigateFunction`: a route path only, so no caller reaches an unguarded form. */
export type GuardedNavigate = (path: string, options?: { replace?: boolean }) => void;

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

/**
 * The entry point for user-initiated page changes (tab bar, swipe commit, keypad tab jump).
 * `BrowserRouter`'s navigator has had no `block` since react-router 6.4 and the app uses no data
 * router, so only the call sites can honour a guard. `navigateToSearchTarget` calls
 * `confirmNavigation` directly for the same reason.
 */
export const useGuardedNavigate = (): GuardedNavigate => {
  const navigate = useNavigate();
  return useCallback<GuardedNavigate>(
    (path, options) => {
      if (!confirmNavigation()) return;
      navigate(path, options);
    },
    [navigate],
  );
};
