/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Full-screen / immersive mode: applies the persisted "hide status bar" /
 * "hide navigation bar" settings (whose defaults come from the active build
 * variant) to the native Android system bars. A no-op off native Android.
 */

import { loadHideNavigationBar, loadHideStatusBar } from "@/lib/config/appSettings";
import { setSystemBarsVisibility } from "@/lib/native/safeArea";

/** Apply the current full-screen settings to the native system bars. */
export const applyFullScreenFromSettings = (): void => {
  void setSystemBarsVisibility({
    statusBar: !loadHideStatusBar(),
    navigationBar: !loadHideNavigationBar(),
  });
};
