import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
  });
});
