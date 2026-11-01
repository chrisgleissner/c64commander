/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

export const DEMO_INTERSTITIAL_SESSION_KEY = "c64u_demo_interstitial_shown";
export const DEMO_MODE_PINNED_SESSION_KEY = "c64u_demo_mode_pinned";
export const DEMO_MODE_DECLINED_SESSION_KEY = "c64u_demo_mode_declined";
export const DEMO_MODE_CHOSEN_SESSION_KEY = "c64u_demo_mode_chosen";

export const persistDemoModeSessionFlag = (key: string, on: boolean) => {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (on) {
      sessionStorage.setItem(key, "1");
    } else {
      sessionStorage.removeItem(key);
    }
  } catch (error) {
    addLog("warn", "Failed to persist demo mode session flag", { error: (error as Error).message, key, on });
  }
};

export const readDemoModeSessionFlag = (key: string): boolean => sessionStorage.getItem(key) === "1";

export type DemoModeSessionFlags = {
  interstitialShown: boolean;
  pinned: boolean;
  chosen: boolean;
  declined: boolean;
};

export const restoreDemoModeSessionFlags = (): DemoModeSessionFlags => ({
  interstitialShown: readDemoModeSessionFlag(DEMO_INTERSTITIAL_SESSION_KEY),
  pinned: readDemoModeSessionFlag(DEMO_MODE_PINNED_SESSION_KEY),
  chosen: readDemoModeSessionFlag(DEMO_MODE_CHOSEN_SESSION_KEY),
  declined: readDemoModeSessionFlag(DEMO_MODE_DECLINED_SESSION_KEY),
});
