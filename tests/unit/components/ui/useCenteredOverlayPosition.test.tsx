import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCenteredOverlayPosition } from "@/components/ui/useCenteredOverlayPosition";
import { assertOverlayRespectsBadgeSafeZone, resolveCenteredOverlayLayout } from "@/components/ui/interstitialStyles";

vi.mock("@/components/ui/interstitialStyles", () => ({
  assertOverlayRespectsBadgeSafeZone: vi.fn(),
  resolveCenteredOverlayLayout: vi.fn((contentHeight: number) => ({
    top: contentHeight + 100,
    maxHeight: 500 - contentHeight,
  })),
}));

type HarnessProps = {
  attachRef?: boolean;
  forwardedRef?: React.ForwardedRef<HTMLDivElement>;
  overlayName?: string;
};

function OverlayHarness({ attachRef = true, forwardedRef, overlayName = "CenteredOverlay" }: HarnessProps) {
  const { composedRef, style } = useCenteredOverlayPosition<HTMLDivElement>(forwardedRef, overlayName);

  return <div data-testid="overlay" ref={attachRef ? composedRef : undefined} style={style} />;
}

describe("useCenteredOverlayPosition", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  let rectHeight = 140;

  beforeEach(() => {
    rectHeight = 140;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 720,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.getAttribute("data-testid") === "overlay" ? rectHeight : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function getBoundingClientRect() {
        if (this.getAttribute("data-testid") === "overlay") {
          return {
            x: 120,
            y: 0,
            top: 0,
            left: 120,
            right: 320,
            bottom: rectHeight,
            width: 200,
            height: rectHeight,
            toJSON: () => ({}),
          } as DOMRect;
        }

        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";

    if (originalResizeObserver) {
      Object.defineProperty(globalThis, "ResizeObserver", {
        value: originalResizeObserver,
        configurable: true,
        writable: true,
      });
    } else {
      // @ts-expect-error test cleanup for missing ResizeObserver environments
      delete globalThis.ResizeObserver;
    }

    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      value: originalRect,
      configurable: true,
    });

    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("skips layout work when the composed ref is not attached", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    render(<OverlayHarness attachRef={false} />);

    expect(resolveCenteredOverlayLayout).not.toHaveBeenCalled();
    expect(assertOverlayRespectsBadgeSafeZone).not.toHaveBeenCalled();
    expect(addEventListenerSpy).not.toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("recomputes layout when the ref attaches after the initial effect pass", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const { rerender } = render(<OverlayHarness attachRef={false} overlayName="LateMountOverlay" />);

    expect(resolveCenteredOverlayLayout).not.toHaveBeenCalled();

    rerender(<OverlayHarness attachRef overlayName="LateMountOverlay" />);

    const overlay = screen.getByTestId("overlay");
    expect(resolveCenteredOverlayLayout).toHaveBeenCalledWith(140);
    expect(assertOverlayRespectsBadgeSafeZone).toHaveBeenCalledWith(
      {
        top: 240,
        right: 320,
        bottom: 380,
        left: 120,
      },
      "LateMountOverlay",
    );
    expect(overlay).toHaveStyle({ top: "240px", maxHeight: "360px" });
    expect(addEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("positions the overlay, forwards object refs, and updates through ResizeObserver", () => {
    const observeMock = vi.fn();
    const disconnectMock = vi.fn();
    let resizeCallback: (() => void) | undefined;

    Object.defineProperty(globalThis, "ResizeObserver", {
      value: class ResizeObserver {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }

        observe = observeMock;
        disconnect = disconnectMock;
      },
      configurable: true,
      writable: true,
    });

    const forwardedRef = React.createRef<HTMLDivElement>();
    const { unmount } = render(<OverlayHarness forwardedRef={forwardedRef} overlayName="DialogOverlay" />);

    const overlay = screen.getByTestId("overlay");
    expect(forwardedRef.current).toBe(overlay);
    expect(overlay).toHaveStyle({ top: "240px", maxHeight: "360px", transform: "translateX(-50%)" });
    expect(resolveCenteredOverlayLayout).toHaveBeenCalledWith(140);
    expect(assertOverlayRespectsBadgeSafeZone).toHaveBeenLastCalledWith(
      {
        top: 240,
        right: 320,
        bottom: 380,
        left: 120,
      },
      "DialogOverlay",
    );
    expect(observeMock).toHaveBeenCalledWith(overlay);

    rectHeight = 180;
    act(() => {
      resizeCallback?.();
    });

    expect(overlay).toHaveStyle({ top: "280px", maxHeight: "320px" });
    expect(resolveCenteredOverlayLayout).toHaveBeenLastCalledWith(180);
    expect(assertOverlayRespectsBadgeSafeZone).toHaveBeenLastCalledWith(
      {
        top: 280,
        right: 320,
        bottom: 460,
        left: 120,
      },
      "DialogOverlay",
    );

    unmount();
    expect(disconnectMock).toHaveBeenCalled();
  });

  it("falls back to window resize listeners and reuses the same layout when nothing changes", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const forwardedRef = vi.fn();

    // @ts-expect-error test branch for environments without ResizeObserver
    delete globalThis.ResizeObserver;

    const { unmount } = render(<OverlayHarness forwardedRef={forwardedRef} overlayName="SelectionBrowser" />);
    const overlay = screen.getByTestId("overlay");

    expect(addEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(forwardedRef).toHaveBeenCalledWith(overlay);
    expect(overlay).toHaveStyle({ top: "240px", maxHeight: "360px" });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(resolveCenteredOverlayLayout).toHaveBeenCalledTimes(3);
    expect(overlay).toHaveStyle({ top: "240px", maxHeight: "360px" });

    unmount();

    expect(forwardedRef).toHaveBeenLastCalledWith(null);
    expect(removeEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
