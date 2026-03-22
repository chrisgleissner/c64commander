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
  it("promotes selection browser dialogs to compact full-screen mode and keeps the footer sticky", () => {
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
    expect(dialog).toHaveAttribute("data-modal-presentation", "fullscreen");
    expect(dialog.className).toContain("inset-2");
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
