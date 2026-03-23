/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { SwipeNavigationLayer } from "@/components/SwipeNavigationLayer";

type GestureCallbacks = {
  onProgress: (dx: number, velocityX: number) => void;
  onCommit: (direction: 1 | -1, metadata: { dx: number; dy: number; velocityX: number }) => void;
  onCancel: (metadata: { dx: number; dy: number; velocityX: number }) => void;
};

const mocks = vi.hoisted(() => ({
  addLog: vi.fn(),
}));

let currentProfile: "compact" | "medium" = "medium";
let capturedCallbacks: GestureCallbacks | null = null;
let shouldThrowDocsPage = false;

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({
    viewportWidth: 390,
    autoProfile: currentProfile,
    profile: currentProfile,
    override: "auto",
    overrideLabel: "Auto",
    tokens: {},
    setOverride: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSwipeGesture", () => ({
  useSwipeGesture: vi.fn((_ref, callbacks: GestureCallbacks) => {
    capturedCallbacks = callbacks;
  }),
}));

vi.mock("@/hooks/useScreenActivity", () => ({
  ScreenActivityProvider: ({ children }: { active: boolean; children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
}));

vi.mock("@/lib/i18n", () => ({
  t: (_key: string, fallback: string) => fallback,
}));

vi.mock("@/pages/HomePage", () => ({ default: () => <div>Home Page</div> }));
vi.mock("@/pages/PlayFilesPage", () => ({ default: () => <div>Play Page</div> }));
vi.mock("@/pages/DisksPage", () => ({ default: () => <div>Disks Page</div> }));
vi.mock("@/pages/ConfigBrowserPage", () => ({ default: () => <div>Config Page</div> }));
vi.mock("@/pages/SettingsPage", () => ({ default: () => <div>Settings Page</div> }));
vi.mock("@/pages/OpenSourceLicensesPage", () => ({ default: () => <div>Open Source Licenses Page</div> }));
vi.mock("@/pages/DocsPage", () => ({
  default: () => {
    if (shouldThrowDocsPage) {
      throw new Error("docs render failed");
    }
    return <div>Docs Page</div>;
  },
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
};

const NavigationProbe = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/config")}>
      Go Config
    </button>
  );
};

const renderLayer = (pathname: string, extra?: React.ReactNode) => {
  window.history.pushState({}, "", pathname);
  return render(
    <BrowserRouter>
      <SwipeNavigationLayer />
      <LocationProbe />
      {extra}
    </BrowserRouter>,
  );
};

describe("SwipeNavigationLayer", () => {
  beforeEach(() => {
    currentProfile = "medium";
    capturedCallbacks = null;
    shouldThrowDocsPage = false;
    mocks.addLog.mockReset();
    document.documentElement.dataset.c64MotionMode = "standard";
    delete (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
  });

  afterEach(() => {
    document.documentElement.dataset.c64MotionMode = "standard";
  });

  it("returns null for unknown routes", () => {
    renderLayer("/unknown");
    expect(screen.queryByTestId("swipe-navigation-runway")).not.toBeInTheDocument();
  });

  it("renders the requested slot and settings sub-routes", async () => {
    renderLayer("/settings/open-source-licenses");
    expect(await screen.findByText("Open Source Licenses Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-settings")).toHaveAttribute("data-slot-active", "true");
    expect(screen.getByTestId("swipe-slot-config")).toHaveAttribute("inert", "");
  });

  it("maps diagnostics deep links into the settings slot", async () => {
    renderLayer("/diagnostics/history");

    expect(await screen.findByText("Settings Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-settings")).toHaveAttribute("data-slot-active", "true");
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/diagnostics/history");
  });

  it("tracks drag progress and cancels back to the same page", async () => {
    renderLayer("/play");
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onProgress(-24, -0.3);
    });
    expect(runway).toHaveAttribute("data-runway-phase", "dragging");

    act(() => {
      capturedCallbacks?.onCancel({ dx: -24, dy: 4, velocityX: -0.3 });
    });
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

    fireEvent.transitionEnd(runway, { target: runway });
    expect(runway).toHaveAttribute("data-runway-phase", "idle");
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] transition-start",
      expect.objectContaining({ reason: "cancel", from: "Play", to: "Play" }),
    );
  });

  it("keeps idle inactive slots empty so page selectors stay unique", async () => {
    renderLayer("/play");

    expect(await screen.findByText("Play Page")).toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");
    expect(screen.getByTestId("swipe-slot-home").textContent).toBe("");
    expect(screen.getByTestId("swipe-slot-disks").textContent).toBe("");
    expect(screen.queryByText("Home Page")).not.toBeInTheDocument();
    expect(screen.queryByText("Disks Page")).not.toBeInTheDocument();
  });

  it("commits swipe navigation with wrap-around and settles on transition end", async () => {
    renderLayer("/docs");
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
    });

    expect(screen.getByTestId("location-probe")).toHaveTextContent("/");
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    expect(runway).toHaveAttribute("data-runway-index", "0");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] transition-start",
      expect.objectContaining({ reason: "swipe", from: "Docs", to: "Home", wrapAround: true }),
    );

    fireEvent.transitionEnd(screen.getByTestId("swipe-slot-home"), { target: screen.getByTestId("swipe-slot-home") });
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

    fireEvent.transitionEnd(runway, { target: runway });
    expect(runway).toHaveAttribute("data-runway-phase", "idle");
    expect(screen.getByTestId("swipe-slot-home")).toHaveAttribute("data-slot-active", "true");
  });

  it("animates route-driven navigation with reduced-motion settings still enabled", async () => {
    currentProfile = "compact";
    document.documentElement.dataset.c64MotionMode = "reduced";
    renderLayer("/", <NavigationProbe />);

    await screen.findByText("Home Page");
    fireEvent.click(screen.getByRole("button", { name: "Go Config" }));

    const container = screen.getByTestId("swipe-navigation-container");
    const runway = screen.getByTestId("swipe-navigation-runway");
    expect(container).toHaveAttribute("data-swipe-motion-mode", "reduced");
    expect(container).toHaveAttribute("data-swipe-effects", "reduced");
    expect(runway.getAttribute("style")).toContain("180ms linear");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "debug",
      "[SwipeNav] route-transition-start",
      expect.objectContaining({ from: "Home", to: "Config", wrapAround: false }),
    );
  });

  it("uses the slow-motion test probe duration for deterministic evidence", async () => {
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    renderLayer("/");
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCancel({ dx: 0, dy: 0, velocityX: 0 });
    });

    expect(runway.getAttribute("style")).toContain("1200ms linear");
  });

  it("ignores further gesture updates while a transition is already in progress", async () => {
    renderLayer("/play");
    const runway = await screen.findByTestId("swipe-navigation-runway");

    act(() => {
      capturedCallbacks?.onCancel({ dx: -12, dy: 0, velocityX: -0.1 });
    });
    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

    act(() => {
      capturedCallbacks?.onProgress(-80, -1);
      capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
    });

    expect(runway).toHaveAttribute("data-runway-phase", "transitioning");
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/play");

    fireEvent.transitionEnd(runway, { target: runway });
    expect(runway).toHaveAttribute("data-runway-phase", "idle");
    expect(screen.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");
  });

  it("suppresses inactive page render failures instead of showing the fallback", async () => {
    shouldThrowDocsPage = true;
    renderLayer("/");

    expect(await screen.findByText("Home Page")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.getByTestId("swipe-slot-docs").textContent).toBe("");
  });

  it("shows the page error boundary for active page failures", async () => {
    shouldThrowDocsPage = true;
    renderLayer("/docs");

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Please try reloading the app.")).toBeInTheDocument();
    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      "[SwipeNav] page render error",
      expect.objectContaining({ message: "docs render failed" }),
    );
  });

  it("forces idle via fallback timeout when transitionend never fires", async () => {
    // Render and find elements with real timers first so async queries work normally.
    renderLayer("/");
    const runway = await screen.findByTestId("swipe-navigation-runway");

    vi.useFakeTimers();
    try {
      act(() => {
        capturedCallbacks?.onCommit(1, { dx: -120, dy: 0, velocityX: -1 });
      });
      expect(runway).toHaveAttribute("data-runway-phase", "transitioning");

      // Do NOT fire transitionEnd — simulate the CSS engine not delivering the event.
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(runway).toHaveAttribute("data-runway-phase", "idle");
      expect(mocks.addLog).toHaveBeenCalledWith("warn", "[SwipeNav] transition-end-fallback", expect.any(Object));
    } finally {
      vi.useRealTimers();
    }
  });
});
