/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDestructiveDialog } from "@/components/ConfirmDestructiveDialog";

const renderDialog = (onConfirm = vi.fn()) => {
  render(
    <ConfirmDestructiveDialog
      open
      onOpenChange={vi.fn()}
      onConfirm={onConfirm}
      title="Reset HVSC?"
      description="This removes the HVSC library installed in the app."
      confirmLabel="Reset"
      idPrefix="hvsc-reset"
    />,
  );
  return onConfirm;
};

describe("ConfirmDestructiveDialog", () => {
  it("runs the action once even when Confirm is activated twice before the dialog closes", () => {
    const onConfirm = renderDialog();
    const confirm = screen.getByTestId("hvsc-reset-confirm");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("offers Cancel as the only way out, with no undersized close control", () => {
    renderDialog();
    expect(screen.getByTestId("hvsc-reset-cancel")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
