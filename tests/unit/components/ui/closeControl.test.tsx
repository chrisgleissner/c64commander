import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AppDialog,
  AppDialogContent,
  AppDialogDescription,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";
import { CloseControl } from "@/components/ui/modal-close-button";

describe("CloseControl", () => {
  it("renders a plain glyph without the legacy wrapped icon styling", () => {
    render(<CloseControl aria-label="Close" />);

    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton.textContent).toContain("×");
    expect(closeButton.querySelector("svg")).toBeNull();
    expect(closeButton.className).not.toContain("rounded-full");
    expect(closeButton.className).not.toContain("shadow-sm");
    expect(closeButton.className).not.toContain("bg-background/80");
    expect(closeButton.className).toContain("focus:ring-2");
    expect(closeButton.className).toContain("focus:ring-ring");
    expect(closeButton.className).toContain("focus:ring-offset-2");
  });

  it("is injected into shared interstitial headers", () => {
    render(
      <AppDialog open onOpenChange={() => undefined}>
        <AppDialogContent>
          <AppDialogHeader>
            <AppDialogTitle>Shared header</AppDialogTitle>
            <AppDialogDescription>Shared description</AppDialogDescription>
          </AppDialogHeader>
        </AppDialogContent>
      </AppDialog>,
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    expect(closeButton.textContent).toContain("×");
    expect(closeButton.querySelector("svg")).toBeNull();
  });
});
