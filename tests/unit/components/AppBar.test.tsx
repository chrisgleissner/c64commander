/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppBar } from "@/components/AppBar";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";

const navigateMock = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/components/UnifiedHealthBadge", () => ({
  UnifiedHealthBadge: ({ className }: { className?: string }) => (
    <button type="button" data-testid="unified-health-badge" className={className} />
  ),
}));

describe("AppBar", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

  beforeEach(() => {
    navigateMock.mockReset();
  });

  afterEach(() => {
    if (originalResizeObserver) {
      Object.defineProperty(globalThis, "ResizeObserver", {
        value: originalResizeObserver,
        configurable: true,
        writable: true,
      });
    } else {
      // @ts-expect-error branch coverage: restore missing ResizeObserver state
      delete globalThis.ResizeObserver;
    }

    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("renders the unified health badge", () => {
    render(<AppBar title="Test" />);

    expect(screen.getByTestId("unified-health-badge")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders only the unified health badge (no separate activity or connectivity indicators)", () => {
    render(<AppBar title="Test" />);

    expect(screen.getByTestId("unified-health-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("diagnostics-activity-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connectivity-indicator")).not.toBeInTheDocument();
  });

  it("applies pt-safe class for Android status bar inset", () => {
    const { container } = render(<AppBar title="Test" />);

    const header = container.querySelector("header");
    expect(header).toHaveClass("pt-safe");
  });

  it("renders custom leading content and child content", () => {
    render(
      <AppBar title="Ignored" subtitle="Subtitle" leading={<div data-testid="leading">Lead</div>}>
        <div data-testid="child">Extra</div>
      </AppBar>,
    );

    expect(screen.getByTestId("leading")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ignored" })).not.toBeInTheDocument();
  });

  it("publishes app-bar height via ResizeObserver and disconnects on cleanup", () => {
    const observeMock = vi.fn();
    const disconnectMock = vi.fn();
    const setPropertySpy = vi.spyOn(document.documentElement.style, "setProperty");

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 48,
    });

    Object.defineProperty(globalThis, "ResizeObserver", {
      value: class ResizeObserver {
        observe = observeMock;
        disconnect = disconnectMock;
      },
      configurable: true,
      writable: true,
    });

    const { unmount } = render(<AppBar title="Test" />);

    expect(setPropertySpy).toHaveBeenCalledWith("--app-bar-height", "48px");
    expect(observeMock).toHaveBeenCalled();

    unmount();
    expect(disconnectMock).toHaveBeenCalled();
  });

  it("falls back to resize events when ResizeObserver is unavailable and ignores zero heights", () => {
    const addEventListenerSpy = vi.spyOn(globalThis, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(globalThis, "removeEventListener");
    const setPropertySpy = vi.spyOn(document.documentElement.style, "setProperty");

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 0,
    });

    // @ts-expect-error branch coverage: simulate browser without ResizeObserver
    delete globalThis.ResizeObserver;

    const { unmount } = render(<AppBar title="Test" subtitle="Subtitle" />);

    expect(setPropertySpy).not.toHaveBeenCalled();
    expect(addEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(screen.getByRole("heading", { name: "Test" })).toBeInTheDocument();
    expect(screen.queryByText("Subtitle")).not.toBeInTheDocument();

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("renders the header with z-[51] so it sits above overlay backdrops at z-50 (badge always readable)", () => {
    const { container } = render(<AppBar title="Test" />);
    const header = container.querySelector("header");
    expect(header).toHaveClass("z-[51]");
    expect(header).not.toHaveClass("z-40");
  });

  it("skips publishing app-bar height while the screen is inactive", () => {
    const setPropertySpy = vi.spyOn(document.documentElement.style, "setProperty");
    const addEventListenerSpy = vi.spyOn(globalThis, "addEventListener");

    render(
      <ScreenActivityProvider active={false}>
        <AppBar title="Idle" />
      </ScreenActivityProvider>,
    );

    expect(setPropertySpy).not.toHaveBeenCalled();
    expect(addEventListenerSpy).not.toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
