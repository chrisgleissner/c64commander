/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useSyncExternalStore } from "react";

/** Whether a CSS media query matches, following it as the window changes. False where there is no window. */
export const useMediaQuery = (query: string): boolean => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, read, () => false);
};
