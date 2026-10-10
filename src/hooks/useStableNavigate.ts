/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useContext } from "react";
import { UNSAFE_NavigationContext, type NavigateOptions, type To } from "react-router-dom";

export type StableNavigate = {
  (to: To, options?: NavigateOptions): void;
  (delta: number): void;
};

/**
 * Navigation to an absolute path, or by history delta, that does not re-render its caller on every route change.
 *
 * react-router's useNavigate reads the location in order to resolve relative paths, so every component using it
 * re-renders whenever the route changes. Pages are kept built while hidden, and a page root holding useNavigate was
 * re-rendered in full on each tab switch. The app navigates only to absolute paths, which need no location.
 */
export const useStableNavigate = (): StableNavigate => {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigator.go(to);
        return;
      }
      if (options?.replace) navigator.replace(to, options.state, options);
      else navigator.push(to, options?.state, options);
    },
    [navigator],
  );
};

const pathnameOf = (navigator: object): string => {
  if ("location" in navigator) {
    const location = navigator.location;
    if (location && typeof location === "object" && "pathname" in location && typeof location.pathname === "string") {
      return location.pathname;
    }
  }
  return window.location.pathname;
};

/**
 * Reads the route the router is on at the moment it is called, for code that needs the path only when it acts. The
 * router's history keeps the current location; reading it there spares the caller the re-render on every route
 * change that useLocation costs.
 */
export const useCurrentPathReader = (): (() => string) => {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  return useCallback(() => pathnameOf(navigator), [navigator]);
};
