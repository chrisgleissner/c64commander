/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { createConfigEntryPrefetch, directoryListingKey } from "@/pages/playFiles/handlers/configEntryPrefetch";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

const file = (path: string): SourceEntry => ({ type: "file", name: path.split("/").pop() ?? path, path });

describe("the directory listings an add hands to config discovery", () => {
  it("spells a directory the same way whichever end of the add wrote it", () => {
    expect(directoryListingKey("/Usb0/Games")).toBe("/Usb0/Games/");
    expect(directoryListingKey("/Usb0/Games/")).toBe("/Usb0/Games/");
    expect(directoryListingKey("Usb0//Games")).toBe("/Usb0/Games/");
  });

  /*
   * Measured on a C64 Ultimate: a `.cfg` next to a PRG stayed unresolved when the program was
   * added, because the folder had never been listed and the ticked files were offered in its place.
   * Leaving the folder out is what sends discovery to list it for real.
   */
  it("leaves out a folder that was never listed, however many files were picked in it", () => {
    const selectedFilesByParent = new Map([["/Usb0/Games/", [file("/Usb0/Games/Game.prg")]]]);
    const prefetch = createConfigEntryPrefetch({
      listingCache: new Map(),
      selectedFilesByParent,
      directoryEntriesFor: () => [file("/Usb0/Games/Game.prg")],
    });

    expect([...prefetch().keys()]).toEqual([]);
  });

  it("includes a listed folder under the key a lookup uses, whichever key it was stored as", () => {
    const listed = [file("/Usb0/Games/Game.prg"), file("/Usb0/Games/Game.cfg")];
    const prefetch = createConfigEntryPrefetch({
      listingCache: new Map([["/Usb0/Games/", listed]]),
      selectedFilesByParent: new Map([["/Usb0/Games/", [file("/Usb0/Games/Game.prg")]]]),
      directoryEntriesFor: () => listed,
    });

    const map = prefetch();
    expect(map.get("/Usb0/Games/")?.map((entry) => entry.name)).toEqual(["Game.prg", "Game.cfg"]);
  });

  it("carries a folder that was listed but had nothing picked in it", () => {
    const prefetch = createConfigEntryPrefetch({
      listingCache: new Map([
        ["/Usb0/", [file("/Usb0/Shared.cfg"), { type: "dir", name: "Games", path: "/Usb0/Games" }]],
      ]),
      selectedFilesByParent: new Map(),
      directoryEntriesFor: () => [],
    });

    expect(
      prefetch()
        .get("/Usb0/")
        ?.map((entry) => entry.name),
    ).toEqual(["Shared.cfg"]);
  });

  /* Rebuilding the whole map per file made a single-folder batch add quadratic (HARD12-015). */
  it("builds a folder's entries once however often it is asked", () => {
    const listed = [file("/Usb0/Games/Game.prg")];
    const directoryEntriesFor = vi.fn(() => listed);
    const prefetch = createConfigEntryPrefetch({
      listingCache: new Map([["/Usb0/Games/", listed]]),
      selectedFilesByParent: new Map([["/Usb0/Games/", listed]]),
      directoryEntriesFor,
    });

    prefetch();
    prefetch();
    prefetch();
    expect(directoryEntriesFor).toHaveBeenCalledTimes(1);
  });
});
