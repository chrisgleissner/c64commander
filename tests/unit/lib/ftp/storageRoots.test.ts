/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import { listPopulatedStorageRoots } from "@/lib/ftp/storageRoots";
import { pickNewDiskFolder } from "@/lib/disks/createDisk";

const dir = (name: string) => ({ name, type: "dir" });
const file = (name: string) => ({ name, type: "file" });

const device = (tree: Record<string, { name: string; type: string }[]>) => async (path: string) => {
  const entries = tree[path];
  if (!entries) throw new Error(`550 ${path}`);
  return { entries };
};

describe("listPopulatedStorageRoots", () => {
  it("leaves out an empty card slot so a new disk defaults to the storage that holds files", async () => {
    const listDirectory = device({
      "/": [dir("SD"), dir("Flash"), dir("Temp"), dir("USB2")],
      "/SD": [],
      "/Flash": [dir("roms")],
      "/Temp": [],
      "/USB2": [dir("Games"), file("x.d64")],
    });

    const roots = await listPopulatedStorageRoots(listDirectory);

    expect(roots).toEqual(["Flash", "USB2"]);
    expect(pickNewDiskFolder(roots)).toBe("/USB2");
  });

  it("treats a card slot whose listing only echoes its own name as empty", async () => {
    const listDirectory = device({
      "/": [dir("SD"), dir("Temp"), dir("USB2")],
      "/SD": [dir("SD")],
      "/Temp": [],
      "/USB2": [dir("Games")],
    });

    const roots = await listPopulatedStorageRoots(listDirectory);

    expect(roots).toEqual(["USB2"]);
    expect(pickNewDiskFolder(roots)).toBe("/USB2");
  });

  it("keeps every root when all of them are empty", async () => {
    const listDirectory = device({ "/": [dir("SD"), dir("Temp")], "/SD": [], "/Temp": [] });

    expect(await listPopulatedStorageRoots(listDirectory)).toEqual(["SD", "Temp"]);
  });

  it("logs a root it cannot list and leaves it out", async () => {
    const listDirectory = device({ "/": [dir("SD"), dir("USB0")], "/USB0": [file("a.prg")] });

    expect(await listPopulatedStorageRoots(listDirectory)).toEqual(["USB0"]);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Could not list a storage root; leaving it out of the storage choice",
      expect.objectContaining({ root: "SD" }),
    );
  });
});
