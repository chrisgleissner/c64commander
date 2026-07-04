/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from "@capacitor/core";

import { getPlatform, isNativePlatform } from "./platform";

export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type SystemBarsVisibility = {
  /** Whether the top status bar is visible (false = hidden / full-screen). */
  statusBar: boolean;
  /** Whether the bottom navigation bar is visible (false = hidden / full-screen). */
  navigationBar: boolean;
};

type SafeAreaPlugin = {
  getInsets: () => Promise<SafeAreaInsets>;
  setSystemBarsVisibility: (options: SystemBarsVisibility) => Promise<void>;
  setSystemBarsAppearance: (options: { light: boolean }) => Promise<void>;
};

const SafeArea = registerPlugin<SafeAreaPlugin>("SafeArea", {
  web: () => import("./safeArea.web").then((module) => new module.SafeAreaWeb()),
});

const SAFE_AREA_PROPERTIES: Array<[keyof SafeAreaInsets, string]> = [
  ["top", "--native-safe-area-inset-top"],
  ["right", "--native-safe-area-inset-right"],
  ["bottom", "--native-safe-area-inset-bottom"],
  ["left", "--native-safe-area-inset-left"],
];

const clampInset = (value: number) => {
  const rounded = Math.round(value);
  return Number.isFinite(rounded) && rounded > 0 ? rounded : 0;
};

const convertPhysicalPixelsToCssPixels = (value: number) => {
  if (typeof window === "undefined") return value;
  const pixelRatio = window.devicePixelRatio;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) return value;
  return value / pixelRatio;
};

const normalizeAndroidInsets = (insets: SafeAreaInsets): SafeAreaInsets => ({
  top: convertPhysicalPixelsToCssPixels(insets.top),
  right: convertPhysicalPixelsToCssPixels(insets.right),
  bottom: convertPhysicalPixelsToCssPixels(insets.bottom),
  left: convertPhysicalPixelsToCssPixels(insets.left),
});

const applyNativeSafeAreaInsets = (insets: SafeAreaInsets) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [key, property] of SAFE_AREA_PROPERTIES) {
    root.style.setProperty(property, `${clampInset(insets[key])}px`);
  }
};

const clearNativeSafeAreaInsets = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [, property] of SAFE_AREA_PROPERTIES) {
    root.style.setProperty(property, "0px");
  }
};

export const syncNativeSafeAreaInsets = async (): Promise<SafeAreaInsets | null> => {
  if (typeof document === "undefined") return null;

  if (!isNativePlatform() || getPlatform() !== "android") {
    clearNativeSafeAreaInsets();
    return null;
  }

  try {
    const insets = normalizeAndroidInsets(await SafeArea.getInsets());
    applyNativeSafeAreaInsets(insets);
    return insets;
  } catch (error) {
    console.warn("Failed to synchronize native safe-area insets", { error });
    clearNativeSafeAreaInsets();
    return null;
  }
};

/**
 * Show/hide the Android system bars (full-screen / immersive). No-op off native
 * Android. After toggling, the safe-area insets are re-synced so content reclaims
 * (or yields) the freed edge.
 */
export const setSystemBarsVisibility = async (options: SystemBarsVisibility): Promise<void> => {
  if (!isNativePlatform() || getPlatform() !== "android") return;
  try {
    await SafeArea.setSystemBarsVisibility(options);
  } catch (error) {
    console.warn("Failed to set system bars visibility", { error });
  }
  await syncNativeSafeAreaInsets();
};

/**
 * Match the native status/navigation-bar icon appearance to the app's resolved
 * theme so the clock/battery icons stay legible over the (transparent, edge-to-
 * edge) bars: light theme → dark icons, dark theme → light icons. No-op off
 * native Android. Re-invoked whenever the resolved theme changes (see useTheme).
 */
export const syncNativeSystemBarAppearance = async (resolvedTheme: "light" | "dark"): Promise<void> => {
  if (!isNativePlatform() || getPlatform() !== "android") return;
  try {
    await SafeArea.setSystemBarsAppearance({ light: resolvedTheme === "light" });
  } catch (error) {
    console.warn("Failed to set native system bar appearance", { error });
  }
};

export const installNativeSafeAreaSync = () => {
  if (typeof window === "undefined") return () => undefined;

  const refresh = () => {
    void syncNativeSafeAreaInsets();
  };

  const handleVisibility = () => {
    if (!document.hidden) refresh();
  };

  refresh();
  window.addEventListener("resize", refresh);
  window.addEventListener("orientationchange", refresh);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    window.removeEventListener("resize", refresh);
    window.removeEventListener("orientationchange", refresh);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
};
