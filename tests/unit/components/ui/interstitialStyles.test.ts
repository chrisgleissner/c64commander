import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertOverlayRespectsBadgeSafeZone,
  getBadgeCriticalBounds,
  getBadgeSafeZoneBottomPx,
  resolveAppSheetTopClearancePx,
  resolveInterstitialBackdropOpacity,
  resolveInterstitialBackdropZIndex,
  resolveInterstitialSurfaceZIndex,
  resolveCenteredOverlayLayout,
  resolveHeaderOverlapDeltaPx,
} from "@/components/ui/interstitialStyles";

const stubRect = (element: HTMLElement, rect: { top: number; left: number; right: number; bottom: number }) => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
};

describe("interstitialStyles", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.setProperty("--app-bar-height", "72px");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--app-bar-height");
    vi.restoreAllMocks();
  });

  it("derives workflow sheet top from the shorter badge lane minus the shared overlap delta", () => {
    const header = document.createElement("div");
    header.dataset.testid = "app-bar-row";
    header.setAttribute("data-testid", "app-bar-row");
    stubRect(header, { top: 0, left: 0, right: 390, bottom: 72 });
    document.body.appendChild(header);

    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    stubRect(badge, { top: 12, left: 280, right: 372, bottom: 54 });
    document.body.appendChild(badge);

    expect(resolveHeaderOverlapDeltaPx()).toBe(11);
    expect(getBadgeSafeZoneBottomPx()).toBe(54);
    expect(resolveAppSheetTopClearancePx()).toBe(43);
  });

  it("keeps centered modals below both the header and badge band", () => {
    const header = document.createElement("div");
    header.setAttribute("data-testid", "app-bar-row");
    stubRect(header, { top: 0, left: 0, right: 390, bottom: 72 });
    document.body.appendChild(header);

    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    stubRect(badge, { top: 12, left: 280, right: 372, bottom: 54 });
    document.body.appendChild(badge);

    const layout = resolveCenteredOverlayLayout(220, 900);
    expect(layout.top).toBeGreaterThanOrEqual(80);
    expect(layout.maxHeight).toBeGreaterThan(220);
  });

  it("assigns deterministic stacked dimming and z-index values by overlay depth", () => {
    expect(resolveInterstitialBackdropOpacity(1)).toBe(0.4);
    expect(resolveInterstitialBackdropOpacity(2)).toBe(0.25);
    expect(resolveInterstitialBackdropOpacity(3)).toBe(0.15);
    expect(resolveInterstitialBackdropOpacity(6)).toBe(0.15);

    expect(resolveInterstitialBackdropZIndex(1)).toBe(200);
    expect(resolveInterstitialBackdropZIndex(2)).toBe(220);
    expect(resolveInterstitialSurfaceZIndex(1)).toBe(210);
    expect(resolveInterstitialSurfaceZIndex(2)).toBe(230);
  });

  it("reports intersections with header title and badge-critical text", () => {
    const title = document.createElement("div");
    title.setAttribute("data-testid", "app-bar-title-zone");
    stubRect(title, { top: 24, left: 16, right: 156, bottom: 52 });
    document.body.appendChild(title);

    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    stubRect(badge, { top: 18, left: 280, right: 372, bottom: 62 });
    document.body.appendChild(badge);

    const badgeText = document.createElement("span");
    badgeText.setAttribute("data-overlay-critical", "badge");
    stubRect(badgeText, { top: 26, left: 290, right: 352, bottom: 48 });
    badge.appendChild(badgeText);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    assertOverlayRespectsBadgeSafeZone({ top: 20, left: 10, right: 180, bottom: 70 }, "title-overlap");
    assertOverlayRespectsBadgeSafeZone({ top: 24, left: 286, right: 360, bottom: 68 }, "badge-overlap");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Header title intersection"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Badge text intersection"));
  });

  it("returns null badge-critical bounds when document is unavailable", () => {
    const originalDocument = global.document;

    try {
      // @ts-expect-error branch coverage: simulate non-DOM runtime
      delete global.document;
      expect(getBadgeCriticalBounds()).toBeNull();
    } finally {
      Object.defineProperty(global, "document", {
        configurable: true,
        value: originalDocument,
        writable: true,
      });
    }
  });

  it("does not emit overlay violations in production mode", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      assertOverlayRespectsBadgeSafeZone({ top: 0, left: 0, right: 10, bottom: 10 }, "prod-noop");
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("ignores a header that has not laid out yet, rather than putting the sheet over the badge", () => {
    // A header measured while it is still animating open reports a fraction of its settled size.
    // Taken at face value that put the sheet 13px from the top of the screen — above the badge it
    // exists to clear — so the app bar's CSS height is used until the measurement is plausible.
    const header = document.createElement("div");
    header.setAttribute("data-testid", "app-bar-row");
    stubRect(header, { top: 0, left: 0, right: 390, bottom: 24 });
    document.body.appendChild(header);

    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    stubRect(badge, { top: 8, left: 280, right: 372, bottom: 21 });
    document.body.appendChild(badge);

    // The badge lane alone would give 21 - 11 = 10.
    expect(getBadgeSafeZoneBottomPx()).toBe(21);
    expect(resolveAppSheetTopClearancePx()).toBeGreaterThan(40);
  });

  it("does not put the sheet across the whole screen when nothing has a position yet", () => {
    // The zero case, which is what a sheet opening on a page whose header has not been placed
    // reads: the sheet filled the viewport top to bottom, over everything it exists to clear.
    const header = document.createElement("div");
    header.setAttribute("data-testid", "app-bar-row");
    stubRect(header, { top: 0, left: 0, right: 0, bottom: 0 });
    document.body.appendChild(header);

    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    stubRect(badge, { top: 0, left: 0, right: 0, bottom: 0 });
    document.body.appendChild(badge);

    expect(resolveAppSheetTopClearancePx()).toBeGreaterThan(40);
  });
});
