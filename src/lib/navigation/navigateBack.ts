/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { App } from "@capacitor/app";

import { addLog } from "@/lib/logging";
import { getPlatform } from "@/lib/native/platform";

/** The router's position in this session's history; BrowserRouter keeps it in `history.state.idx`. */
const routerHistoryIndex = (): number => {
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index === "number" ? index : 0;
};

/**
 * What the Back key does once nothing inside the page is left to close: return to the previous
 * route, or, on the first route of the session, send the app to the background the way Android's
 * own Back does. The app registers a Back listener, which stops Android doing that by itself.
 */
export const navigateBackOrLeave = (navigate: (delta: number) => void): void => {
  if (routerHistoryIndex() > 0) {
    navigate(-1);
    return;
  }
  if (getPlatform() !== "android") return;
  void App.minimizeApp().catch((error) => {
    addLog("warn", "Failed to send the app to the background on Back", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};
