import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import {
  APP_INTERSTITIAL_BACKDROP_CLASSNAME,
  APP_SHEET_TOP_CLEARANCE,
  BADGE_SAFE_ZONE_MARGIN_PX,
  getBadgeSafeZoneBottomPx,
  getBadgeSafeZone,
  assertOverlayRespectsBadgeSafeZone,
  resolveCenteredOverlayLayout,
  resolveAppSheetTopClearancePx,
} from "@/components/ui/interstitialStyles";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

describe("App surface primitives", () => {
  it("renders AppSheet as a bottom sheet on medium widths", () => {
    localStorage.clear();
    setViewportWidth(480);

    render(
      <DisplayProfileProvider>
        <AppSheet open>
          <AppSheetContent>
            <AppSheetHeader>
              <AppSheetTitle>Diagnostics</AppSheetTitle>
            </AppSheetHeader>
            <AppSheetBody>
              <div>Body</div>
            </AppSheetBody>
          </AppSheetContent>
        </AppSheet>
      </DisplayProfileProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-app-surface", "sheet");
    expect(dialog).toHaveAttribute("data-sheet-presentation", "sheet");
    expect(dialog.className).toContain("rounded-t-[var(--interstitial-radius)]");
    expect(dialog.className).toContain("pb-[var(--app-sheet-bottom-clearance)]");
    expect(dialog.getAttribute("style")).toContain(
      "--app-sheet-bottom-clearance: calc(5rem + env(safe-area-inset-bottom))",
    );
    expect(dialog.getAttribute("style")).toContain(`--app-sheet-top-clearance: ${APP_SHEET_TOP_CLEARANCE}`);
    expect(dialog.className).toContain("top-[var(--app-sheet-top-clearance)]");

    const overlay = Array.from(document.body.querySelectorAll<HTMLElement>('[data-state="open"]')).find((element) =>
      element.className.includes("fixed inset-0"),
    );
    expect(overlay?.className).toContain(APP_INTERSTITIAL_BACKDROP_CLASSNAME.split(" ")[0]);
  });

  it("keeps AppSheet as a bottom sheet on expanded widths", () => {
    localStorage.clear();
    setViewportWidth(900);

    render(
      <DisplayProfileProvider>
        <AppSheet open>
          <AppSheetContent>
            <AppSheetHeader>
              <AppSheetTitle>Diagnostics</AppSheetTitle>
            </AppSheetHeader>
            <AppSheetBody>
              <div>Body</div>
            </AppSheetBody>
          </AppSheetContent>
        </AppSheet>
      </DisplayProfileProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-sheet-presentation", "sheet");
    expect(dialog.className).toContain("bottom-0");
    expect(dialog.className).toContain("sm:w-[min(100vw-2rem,56rem)]");
  });

  it("renders AppDialog as a centered decision dialog", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <AppDialog open>
          <AppDialogContent>
            <AppDialogHeader>
              <AppDialogTitle>Save RAM</AppDialogTitle>
            </AppDialogHeader>
            <AppDialogBody>
              <div>Choose a mode</div>
            </AppDialogBody>
            <AppDialogFooter>
              <button type="button">Cancel</button>
            </AppDialogFooter>
          </AppDialogContent>
        </AppDialog>
      </DisplayProfileProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-app-surface", "dialog");
    expect(dialog.className).toContain("w-[min(90vw,32rem)]");

    const overlay = Array.from(document.body.querySelectorAll<HTMLElement>('[data-state="open"]')).find((element) =>
      element.className.includes("fixed inset-0"),
    );
    expect(overlay?.className).toContain(APP_INTERSTITIAL_BACKDROP_CLASSNAME.split(" ")[0]);
    expect(screen.getByText("Choose a mode").parentElement).toHaveClass("flex-1", "overflow-y-auto");
  });

  it("derives sheet clearance from the app bar height so sheets stay below the badge lane", () => {
    document.documentElement.style.setProperty("--app-bar-height", "104px");
    expect(resolveAppSheetTopClearancePx()).toBe(112);
  });

  it("backdrop uses an unblurred 30% darkening layer", () => {
    // The first class in APP_INTERSTITIAL_BACKDROP_CLASSNAME encodes the base opacity.
    // The overlay should darken the background by about 30% without any backdrop blur.
    const baseClass = APP_INTERSTITIAL_BACKDROP_CLASSNAME.split(" ")[0];
    const match = baseClass.match(/bg-black\/(\d+)/);
    expect(match).not.toBeNull();
    const opacity = Number(match![1]);
    expect(opacity).toBe(30);
    expect(APP_INTERSTITIAL_BACKDROP_CLASSNAME).not.toContain("backdrop-blur");
    expect(APP_INTERSTITIAL_BACKDROP_CLASSNAME).not.toContain("supports-[backdrop-filter]");
  });

  it("getBadgeSafeZoneBottomPx returns the same value as resolveAppSheetTopClearancePx", () => {
    document.documentElement.style.setProperty("--app-bar-height", "88px");
    expect(getBadgeSafeZoneBottomPx()).toBe(resolveAppSheetTopClearancePx());
  });

  it("returns null badge bounds when the unified badge is absent", () => {
    expect(getBadgeSafeZone()).toBeNull();
  });

  it("expands the badge bounds into a safe zone rectangle", () => {
    const badge = document.createElement("button");
    badge.setAttribute("data-testid", "unified-health-badge");
    document.body.appendChild(badge);

    vi.spyOn(badge, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 12,
      top: 12,
      left: 200,
      right: 280,
      bottom: 36,
      width: 80,
      height: 24,
      toJSON: () => ({}),
    } as DOMRect);

    expect(getBadgeSafeZone()).toEqual({
      top: 4,
      left: 192,
      right: 288,
      bottom: 44,
    });
  });

  it("BADGE_SAFE_ZONE_MARGIN_PX is 8", () => {
    expect(BADGE_SAFE_ZONE_MARGIN_PX).toBe(8);
  });

  it("resolves centered overlay layout below the badge safe zone", () => {
    document.documentElement.style.setProperty("--app-bar-height", "88px");
    const layout = resolveCenteredOverlayLayout(200, 640);
    expect(layout.top).toBeGreaterThanOrEqual(getBadgeSafeZoneBottomPx() + 8);
    expect(layout.maxHeight).toBe(640 - layout.top - 12);
  });

  it("prefers the visual center when it already clears the badge lane", () => {
    document.documentElement.style.setProperty("--app-bar-height", "88px");
    const layout = resolveCenteredOverlayLayout(120, 900);

    expect(layout.top).toBe(390);
    expect(layout.maxHeight).toBe(498);
  });

  it("enforces a minimum centered overlay max height in cramped viewports", () => {
    document.documentElement.style.setProperty("--app-bar-height", "88px");
    const layout = resolveCenteredOverlayLayout(320, 200);

    expect(layout.maxHeight).toBe(160);
  });
});

describe("assertOverlayRespectsBadgeSafeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs an error when overlay top is above the safe zone bottom", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.documentElement.style.setProperty("--app-bar-height", "80px");
    // safeZoneBottom = max(96, round(80+8)) = 96
    assertOverlayRespectsBadgeSafeZone(50, "TestOverlay");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("TestOverlay");
    expect(spy.mock.calls[0][0]).toContain("Badge safe zone violation");
  });

  it("does not log when overlay top is at or below the safe zone bottom", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.documentElement.style.setProperty("--app-bar-height", "80px");
    // safeZoneBottom = 96; top=96 is exactly on the boundary → allowed
    assertOverlayRespectsBadgeSafeZone(96, "TestOverlay");
    assertOverlayRespectsBadgeSafeZone(200, "TestOverlay2");
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs when overlay bounds intersect the badge safe zone", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    document.body.innerHTML =
      '<button data-testid="unified-health-badge" style="position:fixed;top:10px;left:200px;width:80px;height:24px"></button>';

    const safeZone = getBadgeSafeZone();
    expect(safeZone).not.toBeNull();

    assertOverlayRespectsBadgeSafeZone(
      {
        top: safeZone!.top,
        right: safeZone!.right,
        bottom: safeZone!.bottom,
        left: safeZone!.left,
      },
      "IntersectingOverlay",
    );

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)?.[0]).toContain("intersection");
  });

  it("does not log an intersection when overlay bounds stay outside the badge safe zone", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    document.body.innerHTML =
      '<button data-testid="unified-health-badge" style="position:fixed;top:10px;left:200px;width:80px;height:24px"></button>';

    const safeZone = getBadgeSafeZone();
    expect(safeZone).not.toBeNull();

    assertOverlayRespectsBadgeSafeZone(
      {
        top: 120,
        right: safeZone!.right,
        bottom: 200,
        left: safeZone!.left,
      },
      "NonIntersectingOverlay",
    );

    expect(spy).not.toHaveBeenCalled();
  });
});
