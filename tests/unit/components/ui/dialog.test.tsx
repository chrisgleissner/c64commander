import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

describe("profile-aware dialog surfaces", () => {
  it("uses the shared large modal presentation for selection browsers and keeps the footer sticky", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <Dialog open>
          <DialogContent surface="selection-browser" showClose={false}>
            <DialogHeader>
              <DialogTitle>Add items</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <button type="button">Confirm</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DisplayProfileProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-modal-presentation", "large");
    expect(dialog.className).toContain("max-w-4xl");
    expect(dialog.className).toContain("rounded-[var(--interstitial-radius)]");
    expect(screen.getByText("Confirm").parentElement).toHaveClass("sticky");
  });

  it("keeps alert confirmations centered while still using the shared modal resolver", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear diagnostics</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <button type="button">Clear</button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DisplayProfileProvider>,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-modal-presentation", "centered");
    expect(screen.getByText("Clear").parentElement?.className).not.toContain("sticky");
  });
});
