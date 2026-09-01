/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from "@capacitor/core";

import { getPlatform, isNativePlatform } from "./platform";
import { isLightLuminance, relativeLuminanceFromHsl } from "@/lib/appStyles/colorMath";

export type SystemBarsVisibility = {
  /** Whether the top status bar is visible (false = hidden / full-screen). */
  statusBar: boolean;
  /** Whether the bottom navigation bar is visible (false = hidden / full-screen). */
  navigationBar: boolean;
};

type SafeAreaPlugin = {
  setSystemBarsVisibility: (options: SystemBarsVisibility) => Promise<void>;
  setSystemBarsAppearance: (options: { light: boolean }) => Promise<void>;
};

const SafeArea = registerPlugin<SafeAreaPlugin>("SafeArea", {
  web: () => import("./safeArea.web").then((module) => new module.SafeAreaWeb()),
});

/**
 * Show/hide the Android system bars (full-screen / immersive). No-op off native Android. The
 * `--safe-area-inset-*` properties are left alone: Capacitor's SystemBars plugin rewrites them
 * from the window insets listener once the bars have actually gone, later than this call returns.
 */
export const setSystemBarsVisibility = async (options: SystemBarsVisibility): Promise<void> => {
  if (!isNativePlatform() || getPlatform() !== "android") return;
  try {
    await SafeArea.setSystemBarsVisibility(options);
  } catch (error) {
    console.warn("Failed to set system bars visibility", { error });
  }
};

/**
 * Match the native status/navigation-bar icon appearance to the *resolved background*, not to
 * the light/dark theme setting, so the clock/battery icons stay legible over the (transparent,
 * edge-to-edge) bars regardless of which appearance style is active: a dark-only style (e.g.
 * amber-glow, vault-black) keeps a dark background under the light theme setting too, and light
 * icons on a light bar would be unreadable there (spec.md docs/plans/appearance-styles/spec.md
 * section 7.3). No-op off native Android. Re-invoked whenever the resolved theme changes (see
 * useTheme) and whenever the resolved app style changes (see useAppStyle), since either can move
 * --background.
 */
export const syncNativeSystemBarAppearance = async (): Promise<void> => {
  if (!isNativePlatform() || getPlatform() !== "android") return;
  try {
    const backgroundHsl = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
    const isLightBackground = backgroundHsl ? isLightLuminance(relativeLuminanceFromHsl(backgroundHsl)) : true;
    await SafeArea.setSystemBarsAppearance({ light: isLightBackground });
  } catch (error) {
    console.warn("Failed to set native system bar appearance", { error });
  }
};
