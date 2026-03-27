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
  assertOverlayRespectsBadgeSafeZone,
  getBadgeSafeZone,
  getBadgeSafeZoneBottomPx,
  resolveCenteredOverlayLayout,
  resolveAppSheetTopClearancePx,
  resolveHeaderOverlapDeltaPx,
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
    expect(dialog.getAttribute("style")).toContain(`top: ${resolveAppSheetTopClearancePx()}px`);
    expect(dialog.getAttribute("style")).toContain("z-index: 40");

    const overlay = Array.from(document.body.querySelectorAll<HTMLElement>('[data-state="open"]')).find((element) =>
      element.className.includes("fixed inset-0"),
    );
    expect(overlay?.className).toContain(APP_INTERSTITIAL_BACKDROP_CLASSNAME.split(" ")[0]);
    expect(overlay?.style.zIndex).toBe("20");
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
    expect(dialog.style.zIndex).toBe("40");

    const overlay = Array.from(document.body.querySelectorAll<HTMLElement>('[data-state="open"]')).find((element) =>
      element.className.includes("fixed inset-0"),
    );
    expect(overlay?.className).toContain(APP_INTERSTITIAL_BACKDROP_CLASSNAME.split(" ")[0]);
    expect(screen.getByText("Choose a mode").parentElement).toHaveClass("flex-1", "overflow-y-auto");
  });

  it("derives sheet clearance from the app bar height so sheets stay below the badge lane", () => {
    document.documentElement.style.setProperty("--app-bar-height", "104px");
    expect(resolveAppSheetTopClearancePx()).toBe(92);
  });

  it("backdrop uses an unblurred 40% darkening layer", () => {
    const baseClass = APP_INTERSTITIAL_BACKDROP_CLASSNAME.split(" ")[0];
    const match = baseClass.match(/bg-black\/(\d+)/);
    expect(match).not.toBeNull();
    const opacity = Number(match![1]);
    expect(opacity).toBe(40);
    expect(APP_INTERSTITIAL_BACKDROP_CLASSNAME).not.toContain("backdrop-blur");
    expect(APP_INTERSTITIAL_BACKDROP_CLASSNAME).not.toContain("supports-[backdrop-filter]");
  });

  it("derives the sheet top from the badge bottom minus the shared overlap delta", () => {
    document.documentElement.style.setProperty("--app-bar-height", "88px");
    expect(resolveAppSheetTopClearancePx()).toBe(getBadgeSafeZoneBottomPx() - resolveHeaderOverlapDeltaPx());
  });

  it("returns null badge bounds when the unified badge is absent", () => {
    expect(getBadgeSafeZone()).toBeNull();
  });

  it("returns the measured badge bounds without adding a synthetic margin", () => {
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
      top: 12,
      left: 200,
      right: 280,
      bottom: 36,
    });
  });

  it("caps the shared overlap delta at 12px", () => {
    document.documentElement.style.setProperty("--app-bar-height", "200px");
    expect(resolveHeaderOverlapDeltaPx()).toBe(12);
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

  it("logs an error when overlay top rises above the allowed workflow sheet top", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.documentElement.style.setProperty("--app-bar-height", "80px");
    assertOverlayRespectsBadgeSafeZone(resolveAppSheetTopClearancePx() - 1, "TestOverlay");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("TestOverlay");
    expect(spy.mock.calls[0][0]).toContain("Overlay top violation");
  });

  it("does not log when overlay top is at or below the allowed workflow sheet top", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    document.documentElement.style.setProperty("--app-bar-height", "80px");
    assertOverlayRespectsBadgeSafeZone(resolveAppSheetTopClearancePx(), "TestOverlay");
    assertOverlayRespectsBadgeSafeZone(200, "TestOverlay2");
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs when overlay bounds intersect the header title zone", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const title = document.createElement("div");
    title.setAttribute("data-testid", "app-bar-title-zone");
    document.body.appendChild(title);
    vi.spyOn(title, "getBoundingClientRect").mockReturnValue({
      x: 16,
      y: 20,
      top: 20,
      left: 16,
      right: 160,
      bottom: 48,
      width: 144,
      height: 28,
      toJSON: () => ({}),
    } as DOMRect);

    assertOverlayRespectsBadgeSafeZone(
      {
        top: 18,
        right: 170,
        bottom: 60,
        left: 12,
      },
      "IntersectingOverlay",
    );

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)?.[0]).toContain("Header title intersection");
  });

  it("does not log an intersection when overlay bounds stay outside the header title zone", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const title = document.createElement("div");
    title.setAttribute("data-testid", "app-bar-title-zone");
    document.body.appendChild(title);
    vi.spyOn(title, "getBoundingClientRect").mockReturnValue({
      x: 16,
      y: 20,
      top: 20,
      left: 16,
      right: 160,
      bottom: 48,
      width: 144,
      height: 28,
      toJSON: () => ({}),
    } as DOMRect);

    assertOverlayRespectsBadgeSafeZone(
      {
        top: 120,
        right: 170,
        bottom: 200,
        left: 12,
      },
      "NonIntersectingOverlay",
    );

    expect(spy).not.toHaveBeenCalled();
  });
});
