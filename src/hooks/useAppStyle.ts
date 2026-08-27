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
 * Style axis (spec.md docs/plans/appearance-styles/spec.md), a **sibling** of useTheme rather
 * than a widening of it: a separate localStorage key (following the precedent of
 * c64u_display_profile_override), so useTheme and its 18 existing tests are untouched.
 *
 * `deviceColorScheme` is the Ultimate's own `Color Scheme` setting name, read on connect and on
 * manual refresh only (never polled — spec.md section 7.4, decision D4). Pass null when it has
 * never been probed this session; the "Match my device" choice then falls back to the compiled
 * default and stays that way until a probe succeeds, without ever guessing.
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

  // The `.dark` class has another writer: useTheme's own effect sets it unconditionally from the
  // *raw* theme setting on every theme change, with no knowledge of a style's single-mode clamp.
  // Effects run in commit order (descendants before the ThemeProvider ancestor whose useTheme
  // call owns that effect), so a plain effect here can lose a race and have its clamp overwritten
  // moments later. A MutationObserver makes the clamp self-healing against whichever effect (or
  // anything else) touches the class, instead of depending on effect ordering at all.
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

  // Native system bar + web theme-color both key off the *resolved* background, which a style
  // change can move independent of any theme change, so this must re-run on either.
  useEffect(() => {
    void syncNativeSystemBarAppearance();
    const meta = document.querySelector<HTMLMetaElement>(THEME_COLOR_META_SELECTOR);
    if (meta) {
      const backgroundHsl = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
      if (backgroundHsl) meta.content = `hsl(${backgroundHsl})`;
    }
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
