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

  /**
   * Everything the dialog can check itself is refused before the request goes out, so a failure
   * that survives all of it is almost always the storage folder — and the firmware answers a write
   * into a path it does not have with a bare 500. On a Pixel 4 against a c64u (removable media at
   * /USB2, so the default /USB0 does not exist) creating a disk failed with nothing but "HTTP 500",
   * which says nothing about the one field the user can fix.
   */
  it("turns a bare HTTP status into something the user can act on", async () => {
    const failing = vi.fn(async () => {
      throw new Error("HTTP 500");
    });
    setup(failing);
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.change(screen.getByTestId("new-disk-folder"), { target: { value: "/USB0" } });
    fireEvent.click(screen.getByTestId("new-disk-create"));
    await waitFor(() => expect(screen.getByTestId("new-disk-error")).toHaveTextContent("/USB0"));
    expect(screen.getByTestId("new-disk-error")).toHaveTextContent("HTTP 500");
  });

  it("leaves a message the device actually wrote alone", async () => {
    const failing = vi.fn(async () => {
      throw new Error("Disk full");
    });
    setup(failing);
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.click(screen.getByTestId("new-disk-create"));
    await waitFor(() => expect(screen.getByTestId("new-disk-error")).toHaveTextContent("Disk full"));
    expect(screen.getByTestId("new-disk-error").textContent).not.toMatch(/folder exists/);
  });
});
