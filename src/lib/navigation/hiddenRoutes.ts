/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getAppMode, type AppMode } from "@/lib/appMode/appModeStore";
import { addLog } from "@/lib/logging";
import { isTabPathVisible } from "@/lib/navigation/tabRoutes";

export const HIDDEN_ROUTE_FALLBACK_PATH = "/play";

/** Where a path the app mode hides should go instead, or null when the path may stay. */
export const redirectTargetFor = (pathname: string, appMode: AppMode): string | null =>
  isTabPathVisible(pathname, appMode) ? null : HIDDEN_ROUTE_FALLBACK_PATH;

/** Replaces a hidden initial location before the first render, so a hidden page never paints. */
export const normalizeInitialLocation = (appMode: AppMode = getAppMode()): void => {
  if (typeof window === "undefined") return;
  const target = redirectTargetFor(window.location.pathname, appMode);
  if (target === null) return;
  addLog("info", "Initial location is hidden in this mode; opening Play", { path: window.location.pathname });
  window.history.replaceState(window.history.state, "", target);
};
