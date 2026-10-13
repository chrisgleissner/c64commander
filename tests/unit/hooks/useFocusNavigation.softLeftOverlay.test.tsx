/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/*
 * A keypad that reports its left soft key as KEYCODE_SOFT_LEFT reaches the page as
 * { key: "SoftLeft", code: "SoftLeft" } (forwarded by the native shell). The keypad bar labels that
 * key Back everywhere, including in dialogs, where the navigation handler stands aside and the
 * dialog only answers to Escape.
 */
describe("left soft key inside an open dialog", () => {
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
});
