/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScreenActivityProvider, useScreenActivity } from "@/hooks/useScreenActivity";
import { usePageActivity } from "@/hooks/usePageActivity";

const setAppHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

const renderActivity = (initiallyActive: boolean) => {
  let slotActive = initiallyActive;
  const rendered = renderHook(() => ({ page: usePageActivity(), screen: useScreenActivity() }), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <ScreenActivityProvider active={slotActive}>{children}</ScreenActivityProvider>
    ),
  });
  return {
    result: rendered.result,
    rerender: ({ active }: { active: boolean }) => {
      slotActive = active;
      rendered.rerender();
    },
  };
};

describe("usePageActivity", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "hidden");
  });

  it("is true outside any page slot, like useScreenActivity", () => {
    const { result } = renderHook(() => usePageActivity());
    expect(result.current).toBe(true);
  });

  it("follows the page slot while the app is in the foreground", () => {
    const { result, rerender } = renderActivity(true);
    expect(result.current.page).toBe(true);
    rerender({ active: false });
    expect(result.current.page).toBe(false);
    rerender({ active: true });
    expect(result.current.page).toBe(true);
  });

  it("stays true on the tab on screen while the app is in the background, where screen activity turns false", () => {
    const { result } = renderActivity(true);
    setAppHidden(true);
    expect(result.current.screen).toBe(false);
    expect(result.current.page).toBe(true);
    setAppHidden(false);
    expect(result.current.page).toBe(true);
  });

  it("stays false on a hidden tab while the app goes to the background and back", () => {
    const { result } = renderActivity(false);
    setAppHidden(true);
    expect(result.current.page).toBe(false);
    setAppHidden(false);
    expect(result.current.page).toBe(false);
  });
});
