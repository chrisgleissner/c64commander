/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManageConfigDialog } from "@/pages/home/dialogs/ManageConfigDialog";

const baseConfig = {
  id: "config-1",
  name: "Daily Driver",
  savedAt: "2026-03-26T12:34:56.000Z",
};

const renderDialog = (configs = [baseConfig]) => {
  const onOpenChange = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();

  render(
    <ManageConfigDialog
      open={true}
      onOpenChange={onOpenChange}
      configs={configs}
      onRename={onRename}
      onDelete={onDelete}
    />,
  );

  return { onOpenChange, onRename, onDelete };
};

describe("ManageConfigDialog", () => {
  it("renders the empty state and closes the sheet", () => {
    const { onOpenChange } = renderDialog([]);

    expect(screen.getByText("No saved configurations yet.")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("manage-configs-sheet")).getAllByRole("button", { name: "Close" })[0]);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("falls back to the original config name when the rename draft is blank", () => {
    const { onRename } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onRename).toHaveBeenCalledWith(baseConfig.id, baseConfig.name);
  });

  it("trims the rename draft before saving", () => {
    const { onRename } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  New Name  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onRename).toHaveBeenCalledWith(baseConfig.id, "New Name");
  });

  it("confirms deletion against the selected config", () => {
    const { onDelete } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText('Remove "Daily Driver" from saved app configs.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(baseConfig.id);
  });
});
