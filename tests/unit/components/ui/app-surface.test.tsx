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
  assertOverlayRespectsBadgeSafeZone,
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
  });

  it("derives sheet clearance from the app bar height so sheets stay below the badge lane", () => {
    document.documentElement.style.setProperty("--app-bar-height", "104px");
    expect(resolveAppSheetTopClearancePx()).toBe(112);
  });

  it("backdrop opacity stays below 25% to preserve health badge readability (dimming constraint)", () => {
    // The first class in APP_INTERSTITIAL_BACKDROP_CLASSNAME encodes the base opacity.
    // It must not exceed bg-black/25 so the badge remains clearly readable.
    const baseClass = APP_INTERSTITIAL_BACKDROP_CLASSNAME.split(" ")[0];
    const match = baseClass.match(/bg-black\/(\d+)/);
    expect(match).not.toBeNull();
    const opacity = Number(match![1]);
    expect(opacity).toBeLessThanOrEqual(25);
    // Opacity must also be > 0 so the dimming effect is present.
    expect(opacity).toBeGreaterThan(0);
  });

  it("getBadgeSafeZoneBottomPx returns the same value as resolveAppSheetTopClearancePx", () => {
    document.documentElement.style.setProperty("--app-bar-height", "88px");
    expect(getBadgeSafeZoneBottomPx()).toBe(resolveAppSheetTopClearancePx());
  });

  it("BADGE_SAFE_ZONE_MARGIN_PX is 8", () => {
    expect(BADGE_SAFE_ZONE_MARGIN_PX).toBe(8);
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
});
