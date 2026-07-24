/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewDiskDialog } from "@/components/disks/NewDiskDialog";

const setup = (
  createDisk = vi.fn(async (args) => ({ path: "/p", fileName: "x", filePath: "/x", label: "l", kind: args.kind })),
) => {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(<NewDiskDialog open onOpenChange={onOpenChange} createDisk={createDisk as never} onCreated={onCreated} />);
  return { createDisk, onOpenChange, onCreated };
};

describe("NewDiskDialog", () => {
  it("disables Create until a name is entered", () => {
    setup();
    const create = screen.getByTestId("new-disk-create");
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    expect(create).not.toBeDisabled();
  });

  it("creates a d64 disk with default tracks and closes on success", async () => {
    const { createDisk, onOpenChange, onCreated } = setup();
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.click(screen.getByTestId("new-disk-create"));
    await waitFor(() => expect(createDisk).toHaveBeenCalledTimes(1));
    expect(createDisk).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "/USB0", name: "games", kind: "d64", tracks: 35 }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a validation error for out-of-range tracks and keeps Create disabled", () => {
    setup();
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.change(screen.getByTestId("new-disk-tracks"), { target: { value: "99" } });
    expect(screen.getByTestId("new-disk-error")).toHaveTextContent("D64 tracks must be 35");
    expect(screen.getByTestId("new-disk-create")).toBeDisabled();
  });

  it("surfaces a create failure without closing", async () => {
    const failing = vi.fn(async () => {
      throw new Error("PATH DOESN'T EXIST");
    });
    const { onOpenChange } = setup(failing);
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.click(screen.getByTestId("new-disk-create"));
    await waitFor(() => expect(screen.getByTestId("new-disk-error")).toHaveTextContent("PATH DOESN'T EXIST"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
