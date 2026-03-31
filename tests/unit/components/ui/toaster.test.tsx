/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockDismiss, mockToasts, mockRequestDiagnosticsOpen, mockLoadNotificationDurationMs, capturedToastHandlers } =
  vi.hoisted(() => ({
    mockDismiss: vi.fn(),
    mockToasts: {
      value: [] as Array<{ id: string; title?: string; description?: string; action?: React.ReactElement }>,
    },
    mockRequestDiagnosticsOpen: vi.fn(),
    mockLoadNotificationDurationMs: vi.fn(() => 4000),
    capturedToastHandlers: {
      onClick: undefined as (() => void) | undefined,
      onSwipeStart: undefined as (() => void) | undefined,
      onSwipeEnd: undefined as ((e: any) => void) | undefined,
      onSwipeCancel: undefined as (() => void) | undefined,
    },
  }));

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(() => ({ toasts: mockToasts.value, dismiss: mockDismiss })),
}));

vi.mock("@/components/ui/toast", () => ({
  Toast: vi.fn(
    ({
      children,
      onClick,
      onSwipeStart,
      onSwipeEnd,
      onSwipeCancel,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      onSwipeStart?: () => void;
      onSwipeEnd?: (e: any) => void;
      onSwipeCancel?: () => void;
    }) => {
      capturedToastHandlers.onClick = onClick;
      capturedToastHandlers.onSwipeStart = onSwipeStart;
      capturedToastHandlers.onSwipeEnd = onSwipeEnd;
      capturedToastHandlers.onSwipeCancel = onSwipeCancel;
      return (
        <div data-testid="mock-toast" onClick={onClick}>
          {children}
        </div>
      );
    },
  ),
  ToastTitle: vi.fn(({ children }: { children?: React.ReactNode }) => <div data-testid="toast-title">{children}</div>),
  ToastDescription: vi.fn(({ children }: { children?: React.ReactNode }) => (
    <div data-testid="toast-desc">{children}</div>
  )),
  ToastProvider: vi.fn(({ children, duration }: { children?: React.ReactNode; duration?: number }) => (
    <div data-testid="toast-provider" data-duration={duration}>
      {children}
    </div>
  )),
  ToastViewport: vi.fn(() => <div data-testid="toast-viewport" />),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  requestDiagnosticsOpen: mockRequestDiagnosticsOpen,
}));

vi.mock("@/lib/config/appSettings", () => ({
  APP_SETTINGS_KEYS: { NOTIFICATION_DURATION_MS_KEY: "c64u_notification_duration_ms" },
  loadNotificationDurationMs: mockLoadNotificationDurationMs,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { Toaster } from "@/components/ui/toaster";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Toaster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToasts.value = [];
    capturedToastHandlers.onClick = undefined;
    capturedToastHandlers.onSwipeStart = undefined;
    capturedToastHandlers.onSwipeEnd = undefined;
    capturedToastHandlers.onSwipeCancel = undefined;
  });

  it("renders provider and viewport when there are no toasts", () => {
    render(<Toaster />);
    expect(screen.getByTestId("toast-provider")).toBeInTheDocument();
    expect(screen.getByTestId("toast-viewport")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-toast")).not.toBeInTheDocument();
  });

  it("uses the initial duration from loadNotificationDurationMs", () => {
    mockLoadNotificationDurationMs.mockReturnValue(5000);
    render(<Toaster />);
    expect(screen.getByTestId("toast-provider")).toHaveAttribute("data-duration", "5000");
  });

  it("renders a toast with title and description", () => {
    mockToasts.value = [{ id: "toast-1", title: "Hello", description: "World" }];
    render(<Toaster />);
    expect(screen.getByTestId("toast-title")).toHaveTextContent("Hello");
    expect(screen.getByTestId("toast-desc")).toHaveTextContent("World");
  });

  it("renders a toast without description when not provided", () => {
    mockToasts.value = [{ id: "toast-1", title: "Only a title" }];
    render(<Toaster />);
    expect(screen.getByTestId("toast-title")).toBeInTheDocument();
    expect(screen.queryByTestId("toast-desc")).not.toBeInTheDocument();
  });

  it("renders a toast without title when not provided", () => {
    mockToasts.value = [{ id: "toast-1", description: "No title" }];
    render(<Toaster />);
    expect(screen.queryByTestId("toast-title")).not.toBeInTheDocument();
    expect(screen.getByTestId("toast-desc")).toHaveTextContent("No title");
  });

  it("updates duration when c64u-app-settings-updated event fires with matching key", () => {
    render(<Toaster />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: "c64u_notification_duration_ms", value: 6000 },
        }),
      );
    });
    expect(screen.getByTestId("toast-provider")).toHaveAttribute("data-duration", "6000");
  });

  it("calls loadNotificationDurationMs as fallback when value is not a number", () => {
    mockLoadNotificationDurationMs.mockReturnValue(3000);
    render(<Toaster />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: "c64u_notification_duration_ms", value: "not-a-number" },
        }),
      );
    });
    expect(screen.getByTestId("toast-provider")).toHaveAttribute("data-duration", "3000");
  });

  it("ignores c64u-app-settings-updated events for unrelated keys", () => {
    render(<Toaster />);
    const providerEl = screen.getByTestId("toast-provider");
    const initialDuration = providerEl.getAttribute("data-duration");
    act(() => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: "some_other_key", value: 9999 },
        }),
      );
    });
    expect(screen.getByTestId("toast-provider")).toHaveAttribute("data-duration", initialDuration);
  });

  it("removes event listener on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Toaster />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("c64u-app-settings-updated", expect.any(Function));
  });
});

describe("ToastItem handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedToastHandlers.onClick = undefined;
    capturedToastHandlers.onSwipeStart = undefined;
    capturedToastHandlers.onSwipeEnd = undefined;
    capturedToastHandlers.onSwipeCancel = undefined;
    mockToasts.value = [{ id: "toast-1", title: "Test" }];
  });

  it("click calls dismiss and opens diagnostics", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onClick?.();
    });
    expect(mockDismiss).toHaveBeenCalledWith("toast-1");
    expect(mockRequestDiagnosticsOpen).toHaveBeenCalledWith("error-logs");
  });

  it("click does not dismiss when swipe is active", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onSwipeStart?.();
    });
    act(() => {
      capturedToastHandlers.onClick?.();
    });
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockRequestDiagnosticsOpen).not.toHaveBeenCalled();
  });

  it("left swipe (delta.x < -50) calls dismiss", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onSwipeEnd?.({ detail: { delta: { x: -60 } } });
    });
    expect(mockDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("right swipe (delta.x >= 0) does not call dismiss", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onSwipeEnd?.({ detail: { delta: { x: 10 } } });
    });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it("short left swipe (delta.x = -30) does not call dismiss", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onSwipeEnd?.({ detail: { delta: { x: -30 } } });
    });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it("swipeCancel resets swiping state so next click fires normally", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onSwipeStart?.();
    });
    act(() => {
      capturedToastHandlers.onSwipeCancel?.();
    });
    act(() => {
      capturedToastHandlers.onClick?.();
    });
    expect(mockDismiss).toHaveBeenCalledWith("toast-1");
    expect(mockRequestDiagnosticsOpen).toHaveBeenCalledWith("error-logs");
  });

  it("swipeEnd resets swiping state so next click fires normally", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onSwipeStart?.();
    });
    act(() => {
      capturedToastHandlers.onSwipeEnd?.({ detail: { delta: { x: 10 } } });
    });
    act(() => {
      capturedToastHandlers.onClick?.();
    });
    expect(mockDismiss).toHaveBeenCalledWith("toast-1");
  });
});
