/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { forwardRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockDismiss,
  mockToasts,
  mockRequestDiagnosticsOpen,
  mockLoadNotificationDurationMs,
  capturedToastHandlers,
  capturedToastProps,
} = vi.hoisted(() => ({
  mockDismiss: vi.fn(),
  mockToasts: {
    value: [] as Array<{ id: string; title?: string; description?: string; action?: React.ReactElement }>,
  },
  mockRequestDiagnosticsOpen: vi.fn(),
  mockLoadNotificationDurationMs: vi.fn(() => 4000),
  capturedToastHandlers: {
    onClick: undefined as (() => void) | undefined,
    onSwipeEnd: undefined as ((e: any) => void) | undefined,
  },
  // HARD19-037: record the per-root duration/variant passed to each Radix
  // Toast so we can assert destructive toasts opt out of the notice duration.
  capturedToastProps: {
    value: [] as Array<{ duration?: number; variant?: string }>,
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
      onSwipeEnd,
      duration,
      variant,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      onSwipeEnd?: (e: any) => void;
      duration?: number;
      variant?: string;
    }) => {
      capturedToastHandlers.onClick = onClick;
      capturedToastHandlers.onSwipeEnd = onSwipeEnd;
      capturedToastProps.value.push({ duration, variant });
      return (
        <div data-testid="mock-toast" data-duration={String(duration)} data-variant={variant} onClick={onClick}>
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
  ToastViewport: forwardRef<HTMLOListElement>((_props, ref) => <ol ref={ref} data-testid="toast-viewport" />),
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
    capturedToastHandlers.onSwipeEnd = undefined;
    capturedToastProps.value = [];
  });

  it("marks a toast's action slot so the Quick Menu can offer it to the keypad", () => {
    mockToasts.value = [
      {
        id: "retry",
        title: "Mount failed",
        action: (
          <button type="button" data-testid="retry-button">
            Retry
          </button>
        ),
      } as unknown as (typeof mockToasts.value)[number],
    ];
    render(<Toaster />);

    expect(screen.getByTestId("app-toast-action")).toContainElement(screen.getByTestId("retry-button"));
  });

  // `alwaysVisible` only steers the errors-only filter; spread onto the Radix root it would reach the DOM.
  it("does not hand the always-visible marker to the toast element", async () => {
    mockToasts.value = [{ id: "offline", title: "Offline", alwaysVisible: true } as (typeof mockToasts.value)[number]];
    render(<Toaster />);

    const { Toast } = await import("@/components/ui/toast");
    expect(vi.mocked(Toast).mock.calls[0][0]).not.toHaveProperty("alwaysVisible");
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

// HARD19-037: destructive (error) toasts must not inherit the notice duration.
// ERROR_POLICY §4 says error toasts persist until dismissed or stale-cleared;
// the Radix provider duration must apply to notices only.
describe("Toaster destructive-toast persistence (HARD19-037)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToasts.value = [];
    capturedToastProps.value = [];
  });

  it("passes duration=Infinity to a destructive toast root so it never auto-dismisses", () => {
    mockToasts.value = [{ id: "err-1", title: "Stop failed", variant: "destructive" } as any];
    render(<Toaster />);
    const captured = capturedToastProps.value.find((p) => p.variant === "destructive");
    expect(captured).toBeDefined();
    expect(captured?.duration).toBe(Infinity);
  });

  it("leaves a default notice toast's duration undefined so it inherits the provider duration", () => {
    mockToasts.value = [{ id: "note-1", title: "Saved", variant: "default" } as any];
    render(<Toaster />);
    const captured = capturedToastProps.value.find((p) => p.variant === "default");
    expect(captured).toBeDefined();
    expect(captured?.duration).toBeUndefined();
  });

  it("treats a variant-less toast as a notice (inherits provider duration)", () => {
    mockToasts.value = [{ id: "note-2", title: "Info" } as any];
    render(<Toaster />);
    expect(capturedToastProps.value[0]?.duration).toBeUndefined();
  });

  it("gives each toast its own duration when a destructive and a notice coexist", () => {
    mockToasts.value = [
      { id: "err-2", title: "Update failed", variant: "destructive" } as any,
      { id: "note-3", title: "Queued", variant: "default" } as any,
    ];
    render(<Toaster />);
    const destructive = capturedToastProps.value.find((p) => p.variant === "destructive");
    const notice = capturedToastProps.value.find((p) => p.variant === "default");
    expect(destructive?.duration).toBe(Infinity);
    expect(notice?.duration).toBeUndefined();
  });
});

describe("ToastItem controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedToastHandlers.onClick = undefined;
    capturedToastHandlers.onSwipeEnd = undefined;
    mockToasts.value = [{ id: "toast-1", title: "Stop failed", description: "Device unreachable" }];
  });

  it("tapping the toast body neither dismisses it nor opens Diagnostics", () => {
    render(<Toaster />);
    fireEvent.click(screen.getByTestId("toast-title"));
    fireEvent.click(screen.getByTestId("toast-desc"));
    fireEvent.click(screen.getByTestId("mock-toast"));
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockRequestDiagnosticsOpen).not.toHaveBeenCalled();
  });

  it("the close button dismisses the toast without opening Diagnostics", () => {
    render(<Toaster />);
    const close = screen.getByRole("button", { name: "Close notification" });
    expect(close).toHaveAttribute("data-testid", "app-toast-close");
    fireEvent.click(close);
    expect(mockDismiss).toHaveBeenCalledExactlyOnceWith("toast-1");
    expect(mockRequestDiagnosticsOpen).not.toHaveBeenCalled();
  });

  it("the Details button dismisses the toast and opens Diagnostics on the error logs", () => {
    render(<Toaster />);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(mockDismiss).toHaveBeenCalledExactlyOnceWith("toast-1");
    expect(mockRequestDiagnosticsOpen).toHaveBeenCalledExactlyOnceWith("error-logs");
  });

  it("gives each toast its own close and Details buttons", () => {
    mockToasts.value = [
      { id: "err-1", title: "Stop failed", variant: "destructive" } as any,
      { id: "note-1", title: "Saved" },
    ];
    render(<Toaster />);
    const closeButtons = screen.getAllByTestId("app-toast-close");
    expect(closeButtons).toHaveLength(2);
    expect(screen.getAllByTestId("app-toast-details")).toHaveLength(2);
    fireEvent.click(closeButtons[1]);
    expect(mockDismiss).toHaveBeenCalledExactlyOnceWith("note-1");
  });

  it("left swipe (delta.x < -50) calls dismiss", () => {
    render(<Toaster />);
    act(() => {
      capturedToastHandlers.onSwipeEnd?.({ detail: { delta: { x: -60 } } });
    });
    expect(mockDismiss).toHaveBeenCalledWith("toast-1");
    expect(mockRequestDiagnosticsOpen).not.toHaveBeenCalled();
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
});

describe("Toaster page-area reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToasts.value = [];
    document.documentElement.style.removeProperty("--app-toast-reserved-height");
  });

  it("reserves the toast strip's height out of the page area and releases it on unmount", () => {
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(132);
    try {
      const { unmount } = render(<Toaster />);
      expect(document.documentElement.style.getPropertyValue("--app-toast-reserved-height")).toBe("132px");
      unmount();
      expect(document.documentElement.style.getPropertyValue("--app-toast-reserved-height")).toBe("0px");
    } finally {
      heightSpy.mockRestore();
    }
  });
});
