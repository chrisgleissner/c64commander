import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertOverlayRespectsBadgeSafeZone,
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
    document.documentElement.style.setProperty("--app-bar-height", "80px");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--app-bar-height");
    vi.restoreAllMocks();
  });

  it("derives workflow sheet top from the badge bottom minus the shared overlap delta", () => {
    const header = document.createElement("div");
    header.dataset.testid = "app-bar-row";
    header.setAttribute("data-testid", "app-bar-row");
    stubRect(header, { top: 0, left: 0, right: 390, bottom: 80 });
    document.body.appendChild(header);

    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    stubRect(badge, { top: 18, left: 280, right: 372, bottom: 62 });
    document.body.appendChild(badge);

    expect(resolveHeaderOverlapDeltaPx()).toBe(12);
    expect(getBadgeSafeZoneBottomPx()).toBe(62);
    expect(resolveAppSheetTopClearancePx()).toBe(50);
  });

  it("keeps centered modals below both the header and badge band", () => {
    const header = document.createElement("div");
    header.setAttribute("data-testid", "app-bar-row");
    stubRect(header, { top: 0, left: 0, right: 390, bottom: 92 });
    document.body.appendChild(header);

    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    stubRect(badge, { top: 18, left: 280, right: 372, bottom: 66 });
    document.body.appendChild(badge);

    const layout = resolveCenteredOverlayLayout(220, 900);
    expect(layout.top).toBeGreaterThanOrEqual(100);
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
});
