/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDeviceBackStateForTests } from "@/lib/input/deviceBackButton";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/*
 * A keypad that reports its left soft key as KEYCODE_SOFT_LEFT reaches the page as
 * { key: "SoftLeft", code: "SoftLeft" } (forwarded by the native shell). It is the keypad's Back,
 * including in dialogs, where the navigation handler stands aside and the dialog only answers to
 * Escape.
 */
describe("left soft key inside an open dialog", () => {
  beforeEach(() => __resetDeviceBackStateForTests());

  const renderDialog = (onOpenChange: (open: boolean) => void) =>
    render(
      <FocusNavigationProvider profileId="keypad">
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Choose a value.</DialogDescription>
            <button type="button">Apply</button>
          </DialogContent>
        </Dialog>
      </FocusNavigationProvider>,
    );

  it("closes the dialog as Back does", () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    const apply = screen.getByRole("button", { name: "Apply" });
    apply.focus();

    fireEvent.keyDown(apply, { key: "SoftLeft", code: "SoftLeft" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the dialog while the dialog itself holds focus", () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    const dialog = screen.getByRole("dialog");
    dialog.focus();

    fireEvent.keyDown(dialog, { key: "SoftLeft", code: "SoftLeft" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes once per press, so a held key cannot walk on past the dialog", () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    const apply = screen.getByRole("button", { name: "Apply" });
    apply.focus();

    fireEvent.keyDown(apply, { key: "SoftLeft", code: "SoftLeft", repeat: true });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("sends Back's Escape while an overlay is open even when focus is outside it, as device Back does", () => {
    const escapes = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad">
        <button type="button">On the page</button>
        <div role="dialog" aria-label="Menu" />
      </FocusNavigationProvider>,
    );
    document.addEventListener("keydown", (event) => event.key === "Escape" && escapes());
    const onPage = screen.getByRole("button", { name: "On the page" });
    onPage.focus();

    fireEvent.keyDown(onPage, { key: "SoftLeft", code: "SoftLeft" });

    expect(escapes).toHaveBeenCalledTimes(1);
  });

  it("sends Back's Escape to the document when no element holds focus", () => {
    const escapes = vi.fn();
    render(
      <FocusNavigationProvider profileId="keypad">
        <div role="dialog" aria-label="Menu" />
      </FocusNavigationProvider>,
    );
    document.addEventListener("keydown", (event) => event.key === "Escape" && escapes(event.target));
    const activeElement = vi.spyOn(document, "activeElement", "get").mockReturnValue(null);

    fireEvent.keyDown(document, { key: "SoftLeft", code: "SoftLeft" });
    activeElement.mockRestore();

    expect(escapes).toHaveBeenCalledWith(document);
  });
});
