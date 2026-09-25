/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AddItemsProgressOverlay } from "@/components/itemSelection/AddItemsProgressOverlay";
import { InterstitialStateProvider } from "@/components/ui/interstitial-state";
import { resolveCenteredOverlayLayout } from "@/components/ui/interstitialStyles";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { discoverInteractiveElements, resolveActiveScope } from "@/lib/input/discovery";

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

      const markup = renderToStaticMarkup(
        <InterstitialStateProvider>
          <AddItemsProgressOverlay progress={buildProgress()} testId="progress" />
        </InterstitialStateProvider>,
      );
      expect(markup).toContain('data-testid="progress"');
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

  it("becomes the active keypad scope so the tab bar and page behind it leave the ring", () => {
    render(
      <>
        <button type="button">Page action</button>
        <nav data-focus-scope="tabbar">
          <button type="button">Home tab</button>
        </nav>
        <AddItemsProgressOverlay progress={buildProgress()} onCancel={vi.fn()} testId="progress" />
      </>,
    );

    const scope = resolveActiveScope(document);
    expect(scope).toEqual({ element: screen.getByTestId("progress"), kind: "overlay" });
    expect(discoverInteractiveElements(scope.element)).toEqual([screen.getByRole("button", { name: /cancel/i })]);
  });

  it("keeps keypad Down on Cancel instead of moving onto the hidden tab bar", () => {
    render(
      <FocusNavigationProvider profileId="keypad">
        <button type="button">Page action</button>
        <nav data-focus-scope="tabbar">
          <button type="button">Home tab</button>
        </nav>
        <AddItemsProgressOverlay progress={buildProgress()} onCancel={vi.fn()} testId="progress" />
      </FocusNavigationProvider>,
    );
    const cancel = screen.getByRole("button", { name: /cancel/i });
    cancel.focus();

    fireEvent.keyDown(cancel, { key: "ArrowDown", code: "ArrowDown" });

    expect(document.activeElement).toBe(cancel);
  });

  it("cancels the import on the Android Back key, which arrives as a keyCode-0 Escape on the document", () => {
    const onCancel = vi.fn();
    const onNavigateBack = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad" onNavigateBack={onNavigateBack}>
        <AddItemsProgressOverlay progress={buildProgress()} onCancel={onCancel} testId="progress" />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: "Escape", code: "", keyCode: 0 });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onNavigateBack).not.toHaveBeenCalled();
  });

  it("cancels the import on Escape pressed while Cancel has focus", () => {
    const onCancel = vi.fn();
    render(<AddItemsProgressOverlay progress={buildProgress()} onCancel={onCancel} testId="progress" />);

    fireEvent.keyDown(screen.getByRole("button", { name: /cancel/i }), { key: "Escape", code: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels the import on a keyboard's Back key", () => {
    const onCancel = vi.fn();
    render(<AddItemsProgressOverlay progress={buildProgress()} onCancel={onCancel} testId="progress" />);

    fireEvent.keyDown(document, { key: "BrowserBack", code: "BrowserBack" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("leaves other keys to the controls of the overlay", () => {
    const onCancel = vi.fn();
    render(<AddItemsProgressOverlay progress={buildProgress()} onCancel={onCancel} testId="progress" />);

    fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown" });

    expect(onCancel).not.toHaveBeenCalled();
  });
});
