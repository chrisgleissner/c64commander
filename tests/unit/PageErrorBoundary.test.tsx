/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageErrorBoundary } from "@/App";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  t: (_key: string, fallback: string) => fallback,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, size }: any) => (
    <button onClick={onClick} data-size={size}>
      {children}
    </button>
  ),
}));

const ThrowOnMount = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error("Page render failed");
  return <div data-testid="page-content">Page loaded OK</div>;
};

describe("PageErrorBoundary", () => {
  it("renders children normally when no error occurs", () => {
    render(
      <PageErrorBoundary>
        <ThrowOnMount shouldThrow={false} />
      </PageErrorBoundary>,
    );
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
    expect(screen.queryByTestId("page-error-boundary-fallback")).not.toBeInTheDocument();
  });

  it("shows scoped fallback when a child throws", () => {
    // Suppress console.error for the expected React boundary error log
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PageErrorBoundary>
        <ThrowOnMount shouldThrow={true} />
      </PageErrorBoundary>,
    );
    expect(screen.getByTestId("page-error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('renders "Try again" button in fallback', () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PageErrorBoundary>
        <ThrowOnMount shouldThrow={true} />
      </PageErrorBoundary>,
    );
    expect(screen.getByText("Try again")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("does not fill the full screen — uses constrained height class", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <PageErrorBoundary>
        <ThrowOnMount shouldThrow={true} />
      </PageErrorBoundary>,
    );
    const fallback = screen.getByTestId("page-error-boundary-fallback");
    // Should NOT use min-h-screen (that would take over the full app)
    expect(fallback.className).not.toContain("min-h-screen");
    consoleSpy.mockRestore();
  });

  it('retries rendering after clicking "Try again" when children no longer throw', () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <PageErrorBoundary>
        <ThrowOnMount shouldThrow={true} />
      </PageErrorBoundary>,
    );
    expect(screen.getByTestId("page-error-boundary-fallback")).toBeInTheDocument();

    // Supply non-throwing children before clicking retry so the reset render succeeds
    rerender(
      <PageErrorBoundary>
        <ThrowOnMount shouldThrow={false} />
      </PageErrorBoundary>,
    );
    fireEvent.click(screen.getByText("Try again"));
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("sibling content outside the boundary is unaffected by a child throw", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <PageErrorBoundary>
          <ThrowOnMount shouldThrow={true} />
        </PageErrorBoundary>
        <nav data-testid="tab-bar">Tab bar still alive</nav>
      </div>,
    );
    expect(screen.getByTestId("page-error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("hides a latched fallback while the boundary is inactive", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <PageErrorBoundary active={true}>
        <ThrowOnMount shouldThrow={true} />
      </PageErrorBoundary>,
    );

    expect(screen.getByTestId("page-error-boundary-fallback")).toBeInTheDocument();

    rerender(
      <PageErrorBoundary active={false}>
        <ThrowOnMount shouldThrow={true} />
      </PageErrorBoundary>,
    );

    expect(screen.queryByTestId("page-error-boundary-fallback")).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
