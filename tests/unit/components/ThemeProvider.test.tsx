/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { renderHook, render } from "@testing-library/react";
import { useContext } from "react";
import { ThemeProvider, useThemeContext } from "@/components/ThemeProvider";

describe("ThemeProvider", () => {
  it("renders children and provides theme context via useThemeContext", () => {
    const { getByText } = render(
      <ThemeProvider>
        <span>theme-child</span>
      </ThemeProvider>,
    );
    expect(getByText("theme-child")).toBeTruthy();
  });

  it("exposes theme, setTheme, and resolvedTheme through context", () => {
    const { result } = renderHook(() => useThemeContext(), {
      wrapper: ThemeProvider,
    });
    expect(result.current.theme).toBeDefined();
    expect(typeof result.current.setTheme).toBe("function");
    expect(result.current.resolvedTheme).toMatch(/^(light|dark)$/);
  });

  it("throws when useThemeContext is used outside ThemeProvider", () => {
    expect(() => {
      renderHook(() => useThemeContext());
    }).toThrow("useThemeContext must be used within ThemeProvider");
  });
});
