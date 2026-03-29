import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

  it("supports dialog header overrides, extras, and hidden close controls", () => {
    localStorage.clear();
    setViewportWidth(480);

    render(
      <DisplayProfileProvider>
        <Dialog open>
          <DialogContent showClose={false} closeTestId="dialog-close">
            <DialogHeader
              titleContent={<span data-testid="dialog-title-override">Override title</span>}
              descriptionContent={<span data-testid="dialog-description-override">Override description</span>}
              hideClose
              actions={<button type="button">Action</button>}
            >
              <DialogTitle>Ignored title</DialogTitle>
              <DialogDescription>Ignored description</DialogDescription>
              <div data-testid="dialog-header-extra">Header extra</div>
            </DialogHeader>
            <DialogFooter>
              <button type="button">Confirm</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("dialog-title-override")).toHaveTextContent("Override title");
    expect(screen.getByTestId("dialog-description-override")).toHaveTextContent("Override description");
    expect(screen.getByTestId("dialog-header-extra")).toBeVisible();
    expect(screen.getByRole("button", { name: "Action" })).toBeVisible();
    expect(screen.queryByTestId("dialog-close")).not.toBeInTheDocument();
  });

  it("keeps dialog header string extras below the shared row", () => {
    localStorage.clear();
    setViewportWidth(480);

    render(
      <DisplayProfileProvider>
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Shared row</DialogTitle>
              <DialogDescription>Shared row description</DialogDescription>
              Header note
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </DisplayProfileProvider>,
    );

    expect(screen.getByText("Header note")).toBeVisible();
  });

  it("keeps dialog header actions on the shared row to the left of the close control", () => {
    localStorage.clear();
    setViewportWidth(480);

    render(
      <DisplayProfileProvider>
        <Dialog open>
          <DialogContent>
            <DialogHeader actions={<button type="button">Action</button>}>
              <DialogTitle>Shared row</DialogTitle>
              <DialogDescription>Shared row description</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </DisplayProfileProvider>,
    );

    const headerRow = document.querySelector('[data-interstitial-header-row="true"]');
    const actionsRail = document.querySelector('[data-interstitial-header-actions="true"]');
    const action = screen.getByRole("button", { name: "Action" });
    const close = screen.getByRole("button", { name: "Close" });

    expect(headerRow).not.toBeNull();
    expect(actionsRail).not.toBeNull();
    expect(actionsRail).toContainElement(action);
    expect(actionsRail).toContainElement(close);
    expect(action.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("supports alert dialog header extras and hidden close controls", () => {
    localStorage.clear();
    setViewportWidth(480);

    render(
      <DisplayProfileProvider>
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogHeader
              titleContent={<span data-testid="alert-title-override">Alert override</span>}
              descriptionContent={<span data-testid="alert-description-override">Alert description</span>}
              hideClose
              actions={<button type="button">Inspect</button>}
            >
              <AlertDialogTitle>Ignored alert title</AlertDialogTitle>
              <AlertDialogDescription>Ignored alert description</AlertDialogDescription>
              <div data-testid="alert-header-extra">Alert extra</div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <button type="button">Confirm</button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("alert-title-override")).toHaveTextContent("Alert override");
    expect(screen.getByTestId("alert-description-override")).toHaveTextContent("Alert description");
    expect(screen.getByTestId("alert-header-extra")).toBeVisible();
    expect(screen.getByRole("button", { name: "Inspect" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("keeps alert dialog header string extras below the shared row", () => {
    localStorage.clear();
    setViewportWidth(480);

    render(
      <DisplayProfileProvider>
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Alert title</AlertDialogTitle>
              <AlertDialogDescription>Alert description</AlertDialogDescription>
              Alert note
            </AlertDialogHeader>
          </AlertDialogContent>
        </AlertDialog>
      </DisplayProfileProvider>,
    );

    expect(screen.getByText("Alert note")).toBeVisible();
  });

  it("focuses the dialog surface instead of the close control when it opens", async () => {
    localStorage.clear();
    setViewportWidth(480);

    render(
      <DisplayProfileProvider>
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save RAM</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </DisplayProfileProvider>,
    );

    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close" });

    await waitFor(() => {
      expect(document.activeElement).toBe(dialog);
    });
    expect(document.activeElement).not.toBe(close);
  });
});
