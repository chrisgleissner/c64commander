/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { APP_STYLES, APP_STYLE_RENAMES, DEFAULT_APP_STYLE_ID } from "@/generated/appStyles";

const themeContext = vi.hoisted(() => ({
  theme: "light" as "light" | "dark" | "system",
  resolvedTheme: "light" as "light" | "dark",
}));

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => themeContext,
}));

const syncNativeSystemBarAppearance = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/native/safeArea", () => ({ syncNativeSystemBarAppearance }));

import { useAppStyle } from "@/hooks/useAppStyle";

const APP_STYLE_STORAGE_KEY = "c64u_app_style";

const darkOnlyStyle = APP_STYLES.find((style) => style.modes.length === 1 && style.modes[0] === "dark");
if (!darkOnlyStyle) throw new Error("test fixture assumption failed: no dark-only style in APP_STYLES");
const bothModesStyle = APP_STYLES.find((style) => style.modes.length === 2);
if (!bothModesStyle) throw new Error("test fixture assumption failed: no both-modes style in APP_STYLES");

describe("useAppStyle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-app-style");
    document.documentElement.classList.remove("light", "dark");
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove());
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#000000";
    document.head.appendChild(meta);
    themeContext.theme = "light";
    themeContext.resolvedTheme = "light";
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-app-style");
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.style.removeProperty("--background");
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("defaults to the compiled default style when nothing is stored", () => {
      const { result } = renderHook(() => useAppStyle(null));
      expect(result.current.styleId).toBe(DEFAULT_APP_STYLE_ID);
      expect(result.current.storedStyleId).toBeNull();
    });

    it("reads a stored style id from localStorage", () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, bothModesStyle.id);
      const { result } = renderHook(() => useAppStyle(null));
      expect(result.current.styleId).toBe(bothModesStyle.id);
    });
  });

  describe("DOM effects", () => {
    it("writes data-app-style onto <html>", () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, bothModesStyle.id);
      renderHook(() => useAppStyle(null));
      expect(document.documentElement.getAttribute("data-app-style")).toBe(bothModesStyle.id);
    });

    it("does not touch the .dark class for a style that follows the theme normally", () => {
      document.documentElement.classList.add("light");
      localStorage.setItem(APP_STYLE_STORAGE_KEY, bothModesStyle.id);
      themeContext.theme = "light";
      renderHook(() => useAppStyle(null));
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("clamps .dark onto <html> for a dark-only style even under the light theme setting", () => {
      document.documentElement.classList.add("light");
      localStorage.setItem(APP_STYLE_STORAGE_KEY, darkOnlyStyle.id);
      themeContext.theme = "light";
      themeContext.resolvedTheme = "light";
      renderHook(() => useAppStyle(null));
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("re-asserts the dark-only clamp if something else removes the .dark class afterwards", async () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, darkOnlyStyle.id);
      renderHook(() => useAppStyle(null));
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      // Simulate useTheme's own effect winning a race and clearing .dark from the raw theme
      // setting, with no knowledge of the style's clamp.
      act(() => {
        document.documentElement.classList.remove("dark");
        document.documentElement.classList.add("light");
      });

      await vi.waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(true);
      });
    });

    /*
     * Found switching between two real Ultimates: after a dark-only style clamped `.dark` on,
     * moving to a both-modes style left the app dark under a Light theme setting. useTheme owns
     * the class but its effect keys on the theme setting, which had not changed, so nothing put
     * the class back.
     */
    it("restores the theme's own mode when leaving a dark-only style for a both-modes one", async () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, darkOnlyStyle.id);
      themeContext.theme = "light";
      themeContext.resolvedTheme = "light";
      const { result } = renderHook(() => useAppStyle(null));
      expect(document.documentElement.classList.contains("dark")).toBe(true);

      act(() => {
        result.current.setStyleId(bothModesStyle.id);
      });

      await vi.waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(false);
      });
      expect(document.documentElement.classList.contains("light")).toBe(true);
    });

    it("updates the theme-color meta tag to the resolved --background", () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, bothModesStyle.id);
      document.documentElement.style.setProperty("--background", "10 20% 30%");
      renderHook(() => useAppStyle(null));
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      expect(meta?.content).toBe("hsl(10 20% 30%)");
    });

    it("calls syncNativeSystemBarAppearance when the resolved style changes", () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, bothModesStyle.id);
      renderHook(() => useAppStyle(null));
      expect(syncNativeSystemBarAppearance).toHaveBeenCalled();
    });

    it("re-reads --background when another writer changes the .dark class after this effect ran", async () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, bothModesStyle.id);
      document.documentElement.style.setProperty("--background", "10 20% 30%");
      renderHook(() => useAppStyle(null));
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      expect(meta?.content).toBe("hsl(10 20% 30%)");
      syncNativeSystemBarAppearance.mockClear();

      // useTheme owns the ThemeProvider ancestor, so its effect runs after this hook's and is what
      // actually moves --background. Without observing that mutation both the tag and the native
      // system bar stay on the previous theme's background.
      act(() => {
        document.documentElement.style.setProperty("--background", "200 50% 8%");
        document.documentElement.classList.add("dark");
      });

      await vi.waitFor(() => {
        expect(meta?.content).toBe("hsl(200 50% 8%)");
      });
      expect(syncNativeSystemBarAppearance).toHaveBeenCalled();
    });
  });

  describe("setStyleId", () => {
    it("updates styleId and persists to localStorage", () => {
      const { result } = renderHook(() => useAppStyle(null));
      act(() => {
        result.current.setStyleId(darkOnlyStyle.id);
      });
      expect(result.current.styleId).toBe(darkOnlyStyle.id);
      expect(localStorage.getItem(APP_STYLE_STORAGE_KEY)).toBe(darkOnlyStyle.id);
    });
  });

  describe("unknown-id fallback", () => {
    it("falls back to the default and clears the stale stored value", async () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, "not-a-real-style");
      const { result } = renderHook(() => useAppStyle(null));
      expect(result.current.styleId).toBe(DEFAULT_APP_STYLE_ID);
      await vi.waitFor(() => {
        expect(localStorage.getItem(APP_STYLE_STORAGE_KEY)).toBeNull();
      });
    });
  });

  describe("rename migration", () => {
    it.each(Object.entries(APP_STYLE_RENAMES))(
      "maps the stored id %s to %s at the read and writes it back",
      (oldId, newId) => {
        localStorage.setItem(APP_STYLE_STORAGE_KEY, oldId);
        const { result } = renderHook(() => useAppStyle(null));
        expect(result.current.styleId).toBe(newId);
        expect(result.current.storedStyleId).toBe(newId);
        expect(localStorage.getItem(APP_STYLE_STORAGE_KEY)).toBe(newId);
      },
    );

    it("declares a rename for every id this release retired", () => {
      expect(APP_STYLE_RENAMES).toEqual({
        "modem-grey": "cool-grey",
        "petrol-teal": "ocean-teal",
        "full-sun": "high-contrast",
      });
    });

    it("leaves an id that is not a rename alone, so the unknown-id fallback still runs", async () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, "not-a-real-style");
      const { result } = renderHook(() => useAppStyle(null));
      expect(result.current.styleId).toBe(DEFAULT_APP_STYLE_ID);
      await vi.waitFor(() => {
        expect(localStorage.getItem(APP_STYLE_STORAGE_KEY)).toBeNull();
      });
    });
  });

  describe("Match my device", () => {
    it("resolves to the compiled default while the device has never been probed", () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, "match-my-device");
      const { result } = renderHook(() => useAppStyle(null));
      expect(result.current.isMatchMyDevice).toBe(true);
      expect(result.current.matchedDeviceStyleId).toBeNull();
      expect(result.current.styleId).toBe(DEFAULT_APP_STYLE_ID);
    });

    it("resolves to the mapped style once a device Color Scheme is known", () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, "match-my-device");
      const { result } = renderHook(() => useAppStyle("Ultimate Black"));
      expect(result.current.matchedDeviceStyleId).toBe("vault-black");
      expect(result.current.styleId).toBe("vault-black");
    });

    it("never clears the sentinel itself, even though it resolves via fallback while unprobed", async () => {
      localStorage.setItem(APP_STYLE_STORAGE_KEY, "match-my-device");
      renderHook(() => useAppStyle(null));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(localStorage.getItem(APP_STYLE_STORAGE_KEY)).toBe("match-my-device");
    });
  });
});
