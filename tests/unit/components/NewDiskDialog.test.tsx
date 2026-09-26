/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewDiskDialog } from "@/components/disks/NewDiskDialog";

const setup = (
  createDisk = vi.fn(async (args) => ({ path: "/p", fileName: "x", filePath: "/x", label: "l", kind: args.kind })),
  listStorageRoots = vi.fn(async () => ["SD", "Flash", "Temp", "USB2"]),
) => {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <NewDiskDialog
      open
      onOpenChange={onOpenChange}
      createDisk={createDisk as never}
      onCreated={onCreated}
      listStorageRoots={listStorageRoots}
    />,
  );
  return { createDisk, onOpenChange, onCreated };
};

const deviceFolderShown = () => waitFor(() => expect(screen.getByTestId("new-disk-folder")).not.toHaveValue(""));

describe("NewDiskDialog", () => {
  it("disables Create until a name is entered", async () => {
    setup();
    await deviceFolderShown();
    const create = screen.getByTestId("new-disk-create");
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    expect(create).not.toBeDisabled();
  });

  it("creates a d64 disk with default tracks in a storage folder the device lists, and closes on success", async () => {
    const { createDisk, onOpenChange, onCreated } = setup();
    await waitFor(() => expect(screen.getByTestId("new-disk-folder")).toHaveValue("/SD"));
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.click(screen.getByTestId("new-disk-create"));
    await waitFor(() => expect(createDisk).toHaveBeenCalledTimes(1));
    expect(createDisk).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "/SD", name: "games", kind: "d64", tracks: 35 }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("defaults to the device's removable storage when it has no SD folder", async () => {
    setup(
      undefined,
      vi.fn(async () => ["Flash", "Temp", "USB2"]),
    );
    await waitFor(() => expect(screen.getByTestId("new-disk-folder")).toHaveValue("/USB2"));
  });

  it("keeps a folder the user typed before the device's folders arrive", async () => {
    let resolveRoots: (roots: string[]) => void = () => undefined;
    const listStorageRoots = vi.fn(() => new Promise<string[]>((resolve) => (resolveRoots = resolve)));
    setup(undefined, listStorageRoots);
    fireEvent.change(screen.getByTestId("new-disk-folder"), { target: { value: "/USB2/games" } });
    resolveRoots(["SD", "USB2"]);
    await waitFor(() => expect(listStorageRoots).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.getByTestId("new-disk-folder")).toHaveValue("/USB2/games");
  });

  it("offers the storage the device lists now, not a folder from an earlier visit, after a create and reopen", async () => {
    let roots = ["SD", "USB2"];
    const listStorageRoots = vi.fn(async () => roots);
    const createDisk = vi.fn(async (args) => ({
      path: "/p",
      fileName: "x",
      filePath: "/x",
      label: "l",
      kind: args.kind,
    }));
    const props = { onOpenChange: vi.fn(), createDisk: createDisk as never, listStorageRoots };
    const view = render(<NewDiskDialog open {...props} />);
    await waitFor(() => expect(screen.getByTestId("new-disk-folder")).toHaveValue("/SD"));
    fireEvent.change(screen.getByTestId("new-disk-folder"), { target: { value: "/SD/old" } });
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.click(screen.getByTestId("new-disk-create"));
    await waitFor(() => expect(createDisk).toHaveBeenCalledTimes(1));

    view.rerender(<NewDiskDialog open={false} {...props} />);
    roots = ["Flash", "USB0"];
    view.rerender(<NewDiskDialog open {...props} />);

    await waitFor(() => expect(screen.getByTestId("new-disk-folder")).toHaveValue("/USB0"));
  });

  it("offers the new device's storage when the connected device changes while the dialog is open", async () => {
    let roots = ["SD", "USB2"];
    const listStorageRoots = vi.fn(async () => roots);
    setup(undefined, listStorageRoots);
    await waitFor(() => expect(screen.getByTestId("new-disk-folder")).toHaveValue("/SD"));

    fireEvent.change(screen.getByTestId("new-disk-folder"), { target: { value: "/SD/typed-for-the-old-device" } });
    roots = ["Flash", "USB0"];
    act(() => {
      window.dispatchEvent(new CustomEvent("c64u-connection-change", { detail: { baseUrl: "http://u64" } }));
    });

    await waitFor(() => expect(screen.getByTestId("new-disk-folder")).toHaveValue("/USB0"));
  });

  it("shows a validation error for out-of-range tracks and keeps Create disabled", async () => {
    setup();
    await deviceFolderShown();
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
    await deviceFolderShown();
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
    await deviceFolderShown();
    fireEvent.change(screen.getByTestId("new-disk-name"), { target: { value: "games" } });
    fireEvent.click(screen.getByTestId("new-disk-create"));
    await waitFor(() => expect(screen.getByTestId("new-disk-error")).toHaveTextContent("Disk full"));
    expect(screen.getByTestId("new-disk-error").textContent).not.toMatch(/folder exists/);
  });
});
