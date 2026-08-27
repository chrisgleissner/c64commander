/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { DEFAULT_APP_STYLE_ID } from "@/generated/appStyles";

vi.mock("@/components/ThemeProvider", () => ({
  useThemeContext: () => ({ theme: "light", resolvedTheme: "light" }),
}));
vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: { isConnected: false } }),
}));
vi.mock("@/lib/native/safeArea", () => ({ syncNativeSystemBarAppearance: vi.fn(async () => undefined) }));

import { AppStyleProvider, useAppStyleContext } from "@/components/AppStyleProvider";

describe("AppStyleProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-app-style");
    document.documentElement.classList.remove("light", "dark");
  });

  it("renders children", () => {
    const { getByText } = render(
      <AppStyleProvider>
        <span>style-child</span>
      </AppStyleProvider>,
    );
    expect(getByText("style-child")).toBeTruthy();
  });

  it("exposes the resolved style, setter, and device-refresh function via context", () => {
    const { result } = renderHook(() => useAppStyleContext(), { wrapper: AppStyleProvider });
    expect(result.current.styleId).toBe(DEFAULT_APP_STYLE_ID);
    expect(typeof result.current.setStyleId).toBe("function");
    expect(typeof result.current.refreshDeviceColorScheme).toBe("function");
    expect(result.current.styles.length).toBeGreaterThan(0);
  });

  it("throws when useAppStyleContext is used outside AppStyleProvider", () => {
    expect(() => {
      renderHook(() => useAppStyleContext());
    }).toThrow("useAppStyleContext must be used within AppStyleProvider");
  });
});
