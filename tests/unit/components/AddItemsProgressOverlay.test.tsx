/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { AddItemsProgressOverlay } from "@/components/itemSelection/AddItemsProgressOverlay";
import { resolveCenteredOverlayLayout } from "@/components/ui/interstitialStyles";

const buildProgress = (overrides?: Partial<Parameters<typeof AddItemsProgressOverlay>[0]["progress"]>) => ({
  status: "scanning" as const,
  count: 3,
  elapsedMs: 65000,
  total: 10,
  message: "Scanning now",
  ...overrides,
});

describe("AddItemsProgressOverlay", () => {
  it("renders nothing when visibility is disabled", () => {
    const { container } = render(<AddItemsProgressOverlay progress={buildProgress()} visible={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders progress details and handles cancel", () => {
    const onCancel = vi.fn();

    render(<AddItemsProgressOverlay progress={buildProgress()} onCancel={onCancel} testId="progress" />);

    expect(screen.getByTestId("progress")).toBeInTheDocument();
    expect(screen.getByText(/Scanning now/)).toBeInTheDocument();
    expect(screen.getByText(/3 found/)).toBeInTheDocument();
    expect(screen.getByText("01:05")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("portals the overlay to document.body to avoid transformed parent bounds", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    try {
      render(<AddItemsProgressOverlay progress={buildProgress()} testId="progress" />, { container: host });

      const overlay = screen.getByTestId("progress");
      expect(overlay.parentElement).toBe(document.body);
      expect(host).not.toContainElement(overlay);
    } finally {
      host.remove();
    }
  });

  it("hides when not scanning and visibility is undefined", () => {
    const { container } = render(<AddItemsProgressOverlay progress={buildProgress({ status: "done" })} />);

    expect(container.firstChild).toBeNull();
  });

  it("stays visible when explicitly forced on after scanning finishes", () => {
    render(<AddItemsProgressOverlay progress={buildProgress({ status: "done" })} visible testId="progress" />);

    expect(screen.getByTestId("progress")).toBeInTheDocument();
  });

  it("anchors below the badge lane and falls back to the default status text", () => {
    render(
      <AddItemsProgressOverlay
        progress={buildProgress({ elapsedMs: 900, message: null, total: null })}
        testId="progress"
      />,
    );

    const overlay = screen.getByTestId("progress");
    expect(overlay).toHaveStyle({ paddingTop: `${resolveCenteredOverlayLayout(176).top}px` });
    expect(screen.getByText(/Scanning files/)).toBeInTheDocument();
    expect(screen.getByText(/3 found/)).toBeInTheDocument();
    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it("returns the overlay element directly when document is unavailable", () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;

    try {
      // @ts-expect-error exercise the non-DOM fallback branch directly
      delete globalThis.document;
      // @ts-expect-error exercise the non-DOM fallback branch directly
      delete globalThis.window;

      const result = AddItemsProgressOverlay({ progress: buildProgress(), testId: "progress" });
      expect(isValidElement(result)).toBe(true);
      expect(result?.props["data-testid"]).toBe("progress");
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  });
});
