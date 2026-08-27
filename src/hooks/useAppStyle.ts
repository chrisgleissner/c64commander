/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useState } from "react";
import { useThemeContext } from "@/components/ThemeProvider";
import { APP_STYLES, DEFAULT_APP_STYLE_ID } from "@/generated/appStyles";
import { MATCH_MY_DEVICE_SENTINEL, resolveMatchMyDeviceStyleId } from "@/lib/appStyles/matchMyDevice";
import { resolveAppearance } from "@/lib/appStyles/resolveAppearance";
import { syncNativeSystemBarAppearance } from "@/lib/native/safeArea";

const APP_STYLE_STORAGE_KEY = "c64u_app_style";
const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]';

const readStoredStyleId = (): string | null => localStorage.getItem(APP_STYLE_STORAGE_KEY);

/**
 * Style axis (spec.md), a sibling of useTheme rather than a widening of it: a separate
 * localStorage key, so useTheme and its existing tests are untouched.
 *
 * `deviceColorScheme` is the Ultimate's own `Color Scheme` name. Pass null when it has never been
 * probed this session; "Match my device" then falls back to the compiled default, never a guess.
 */
export function useAppStyle(deviceColorScheme: string | null) {
  const { theme, resolvedTheme } = useThemeContext();
  const [storedStyleId, setStoredStyleIdState] = useState<string | null>(readStoredStyleId);

  const isMatchMyDevice = storedStyleId === MATCH_MY_DEVICE_SENTINEL;
  const matchedDeviceStyleId = isMatchMyDevice ? resolveMatchMyDeviceStyleId(deviceColorScheme) : null;
  const effectiveStoredStyleId = isMatchMyDevice ? matchedDeviceStyleId : storedStyleId;

  const resolved = resolveAppearance({
    storedStyleId: effectiveStoredStyleId,
    theme,
    // Correct exactly when theme === "system" (the only case resolveAppearance reads it); when
    // theme is a fixed light/dark setting resolvedTheme already equals it, so this is never wrong.
    systemPrefersDark: resolvedTheme === "dark",
  });

  const setStyleId = useCallback((next: string) => {
    setStoredStyleIdState(next);
    localStorage.setItem(APP_STYLE_STORAGE_KEY, next);
  }, []);

  // Rule 3 (spec.md section 7.1): an id that matches no compiled style — a downgrade, or a style
  // retired from the YAML — falls back to the default and the stale stored value is cleared, so
  // it does not linger and re-trigger this fallback silently forever. Never clears the "Match my
  // device" sentinel itself: that one is allowed to resolve to nothing (matchedDeviceStyleId ===
  // null) whenever the device has not been probed, without being treated as invalid.
  useEffect(() => {
    if (resolved.fellBackToDefault && !isMatchMyDevice && storedStyleId !== null) {
      localStorage.removeItem(APP_STYLE_STORAGE_KEY);
      setStoredStyleIdState(null);
    }
  }, [resolved.fellBackToDefault, isMatchMyDevice, storedStyleId]);

  // data-app-style has no other writer, so a plain effect is enough for it.
  useEffect(() => {
    document.documentElement.setAttribute("data-app-style", resolved.styleId);
  }, [resolved.styleId]);

  // The `.dark` class has another writer: useTheme's effect sets it from the *raw* theme setting,
  // with no knowledge of a style's single-mode clamp, and it runs after this one (ancestor effects
  // run last). A MutationObserver makes the clamp self-healing against that writer instead of
  // depending on effect ordering.
  useEffect(() => {
    if (!resolved.themeClamped) return;
    const shouldHaveDark = resolved.mode === "dark";
    const enforce = () => {
      if (document.documentElement.classList.contains("dark") !== shouldHaveDark) {
        document.documentElement.classList.toggle("dark", shouldHaveDark);
        document.documentElement.classList.toggle("light", !shouldHaveDark);
      }
    };
    enforce();
    const observer = new MutationObserver(enforce);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [resolved.mode, resolved.themeClamped]);

  // Native system bar + web theme-color both read the *computed* --background, which only settles
  // once both writers of the `.dark` class have run. Re-syncing on every class/attribute change,
  // rather than on the React deps alone, is what keeps them from being left one theme behind.
  useEffect(() => {
    const syncChrome = () => {
      void syncNativeSystemBarAppearance();
      const meta = document.querySelector<HTMLMetaElement>(THEME_COLOR_META_SELECTOR);
      if (meta) {
        const backgroundHsl = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
        if (backgroundHsl) meta.content = `hsl(${backgroundHsl})`;
      }
    };
    syncChrome();
    const observer = new MutationObserver(syncChrome);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-app-style"] });
    return () => observer.disconnect();
  }, [resolved.styleId, resolved.mode]);

  return {
    /** The raw stored value: a real style id, the "Match my device" sentinel, or null (unset). */
    storedStyleId,
    setStyleId,
    isMatchMyDevice,
    /** Only meaningful when isMatchMyDevice; null means the device has not been probed (yet). */
    matchedDeviceStyleId,
    styleId: resolved.styleId,
    mode: resolved.mode,
    themeClamped: resolved.themeClamped,
    styles: APP_STYLES,
    defaultStyleId: DEFAULT_APP_STYLE_ID,
  };
}
