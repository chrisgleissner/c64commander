/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useContext, useEffect } from "react";
import { UNSAFE_NavigationContext, useLocation } from "react-router-dom";

type NavigationGuard = () => boolean;
type RetryTransition = { retry: () => void };
type BlockableNavigator = {
  block?: (blocker: (transition: RetryTransition) => void) => () => void;
};

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

export const installNavigationBlocker = (navigator: BlockableNavigator) => {
  if (typeof navigator.block !== "function") {
    return () => undefined;
  }

  let unblock: (() => void) | null = null;
  let pendingTransition: RetryTransition | null = null;

  const handleTransition = (transition: RetryTransition) => {
    if (!confirmNavigation()) {
      return;
    }

    if (!unblock) {
      pendingTransition = transition;
      return;
    }

    unblock();
    transition.retry();
  };

  unblock = navigator.block(handleTransition);

  if (pendingTransition) {
    const transition = pendingTransition;
    pendingTransition = null;
    unblock();
    transition.retry();
  }

  return unblock;
};

export const useNavigationGuardBlocker = () => {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();

  useEffect(() => installNavigationBlocker(navigator as BlockableNavigator), [location.key, navigator]);
};
