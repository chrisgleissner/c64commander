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

const navigateMock = vi.fn();
const unsubscribeMock = vi.fn();

const diagnosticsOverlayStateRef = {
  current: false,
};

const diagnosticsOverlaySubscriberRef: {
  current: ((active: boolean) => void) | null;
} = {
  current: null,
};

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const requestDiagnosticsOpen = vi.fn();

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  requestDiagnosticsOpen: (...args: unknown[]) => requestDiagnosticsOpen(...args),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  isDiagnosticsOverlayActive: () => diagnosticsOverlayStateRef.current,
  subscribeDiagnosticsOverlay: (listener: (active: boolean) => void) => {
    diagnosticsOverlaySubscriberRef.current = listener;
    return unsubscribeMock;
  },
}));

vi.mock("@/components/DiagnosticsActivityIndicator", () => ({
  DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="diagnostics-activity-indicator" onClick={onClick} />
  ),
}));

vi.mock("@/components/ConnectivityIndicator", () => ({
  ConnectivityIndicator: () => <div data-testid="connectivity-indicator" />,
}));

describe("AppBar", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

  beforeEach(() => {
    navigateMock.mockReset();
    requestDiagnosticsOpen.mockReset();
    unsubscribeMock.mockReset();
    diagnosticsOverlayStateRef.current = false;
    diagnosticsOverlaySubscriberRef.current = null;
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

  it("opens diagnostics actions when activity indicator is clicked", () => {
    render(<AppBar title="Test" />);

    fireEvent.click(screen.getByTestId("diagnostics-activity-indicator"));

    expect(requestDiagnosticsOpen).toHaveBeenCalledWith("actions");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders activity indicator before connectivity indicator", () => {
    render(<AppBar title="Test" />);

    const activity = screen.getByTestId("diagnostics-activity-indicator");
    const connectivity = screen.getByTestId("connectivity-indicator");

    const position = activity.compareDocumentPosition(connectivity);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it("falls back to resize events when ResizeObserver is unavailable and ignores zero heights", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
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
    expect(screen.getByText("Subtitle")).toBeInTheDocument();

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
