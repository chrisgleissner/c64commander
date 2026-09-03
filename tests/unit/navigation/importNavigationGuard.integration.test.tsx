/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter, useLocation } from "react-router-dom";

import { TabBar } from "@/components/TabBar";
import { registerNavigationGuard, useGuardedNavigate } from "@/lib/navigation/navigationGuards";
import { createTabJumpShortcut } from "@/lib/navigation/tabRoutes";

/* The keypad's digit shortcut, wired exactly as `App` wires it. */
const KeypadJumpProbe = () => {
  const jumpToTab = createTabJumpShortcut(useGuardedNavigate());
  return (
    <button data-testid="keypad-jump" onClick={() => jumpToTab(4)}>
      jump
    </button>
  );
};

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

/*
 * The production router is `BrowserRouter`. Since react-router 6.4 its navigator has no `block`,
 * so a guard can only be honoured by the navigation call sites themselves. These tests render the
 * real router and drive the real tab button, which is the path an import-in-progress has to survive.
 */
describe("navigation guards under the production router", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("keeps the user on the page when a registered guard refuses a tab tap", () => {
    window.history.pushState({}, "", "/play");
    const guard = vi.fn(() => false);
    const release = registerNavigationGuard(guard);

    try {
      render(
        <BrowserRouter>
          <TabBar />
          <LocationProbe />
        </BrowserRouter>,
      );

      fireEvent.click(screen.getByTestId("tab-settings"));

      expect(guard).toHaveBeenCalled();
      expect(screen.getByTestId("location").textContent).toBe("/play");
    } finally {
      release();
    }
  });

  it("lets the tab tap through when every guard consents", () => {
    window.history.pushState({}, "", "/play");
    const release = registerNavigationGuard(() => true);

    try {
      render(
        <BrowserRouter>
          <TabBar />
          <LocationProbe />
        </BrowserRouter>,
      );

      fireEvent.click(screen.getByTestId("tab-settings"));

      expect(screen.getByTestId("location").textContent).toBe("/settings");
    } finally {
      release();
    }
  });

  it("keeps the user on the page when a guard refuses the keypad tab jump", () => {
    window.history.pushState({}, "", "/play");
    const guard = vi.fn(() => false);
    const release = registerNavigationGuard(guard);

    try {
      render(
        <BrowserRouter>
          <KeypadJumpProbe />
          <LocationProbe />
        </BrowserRouter>,
      );

      fireEvent.click(screen.getByTestId("keypad-jump"));

      expect(guard).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("location").textContent).toBe("/play");

      guard.mockReturnValue(true);
      fireEvent.click(screen.getByTestId("keypad-jump"));

      expect(screen.getByTestId("location").textContent).toBe("/settings");
    } finally {
      release();
    }
  });
});
