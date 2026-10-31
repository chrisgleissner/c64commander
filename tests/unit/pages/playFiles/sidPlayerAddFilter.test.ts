/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { addItemsEntryFilter, addItemsSourceGroups } from "@/pages/playFiles/addItemsFilter";
import type { SourceEntry } from "@/lib/sourceNavigation/types";
import type { SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";

const entry = (name: string, type: "file" | "dir" = "file"): SourceEntry =>
  ({ name, path: `/${name}`, type }) as unknown as SourceEntry;

describe("Add items in SID Player", () => {
  it("SPM-PLAY-02 SID Player adds SID files only", () => {
    const keep = addItemsEntryFilter("sid-player");
    expect(keep(entry("tune.sid"))).toBe(true);
    expect(keep(entry("TUNE.SID"))).toBe(true);
    expect(keep(entry("Music", "dir"))).toBe(true);
    for (const name of ["game.prg", "disk.d64", "cart.crt", "song.mod", "readme.txt"]) {
      expect(keep(entry(name)), name).toBe(false);
    }
  });

  it("SPM-PLAY-02 the Full App keeps every playable kind", () => {
    const keep = addItemsEntryFilter("full");
    for (const name of ["tune.sid", "game.prg", "disk.d64", "cart.crt", "song.mod"]) {
      expect(keep(entry(name)), name).toBe(true);
    }
    expect(keep(entry("readme.txt"))).toBe(false);
  });

  const groups = [
    { label: "This device", sources: [{ id: "local", type: "local" }] },
    { label: "C64U", sources: [{ id: "u", type: "ultimate" }] },
    { label: "HVSC", sources: [{ id: "h", type: "hvsc" }] },
    { label: "CommoServe", sources: [{ id: "c", type: "commoserve" }] },
  ] as unknown as SourceGroup[];

  it("SPM-PLAY-01 SID Player offers no C64U source: Local, HVSC and CommoServe only", () => {
    expect(addItemsSourceGroups("sid-player", groups).map((group) => group.label)).toEqual([
      "This device",
      "HVSC",
      "CommoServe",
    ]);
  });

  it("SPM-PLAY-01 the Full App lists every source", () => {
    expect(addItemsSourceGroups("full", groups)).toHaveLength(4);
  });
});
