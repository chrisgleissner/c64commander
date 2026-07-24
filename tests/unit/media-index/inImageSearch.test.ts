/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  childPath,
  hasFreshChildren,
  isChildEntry,
  migrateSnapshotToV2,
  reconcileChildren,
  replaceChildren,
  searchMediaEntries,
  toChildEntry,
  type MediaEntryV2,
} from "@/lib/media-index/inImageSearch";
import type { DiskDirectoryEntry } from "@/lib/disks/diskImage";

const dirEntry = (overrides: Partial<DiskDirectoryEntry> = {}): DiskDirectoryEntry => ({
  index: 2,
  name: "TURRICAN",
  rawName: new Uint8Array(16),
  type: "PRG",
  closed: true,
  locked: false,
  startTrack: 1,
  startSector: 0,
  blocks: 40,
  ...overrides,
});

const child = (diskPath: string, name: string, index = 0, mtime = "2026-01-01", size = 174848): MediaEntryV2 =>
  toChildEntry(diskPath, "d64", size, mtime, dirEntry({ index, name }));

describe("inImageSearch — migration", () => {
  it("upgrades a v1 snapshot losslessly (no containers)", () => {
    const v1 = {
      version: 1 as const,
      updatedAt: "2026-01-02",
      entries: [{ path: "/GAMES/A.D64", name: "A", type: "disk" as const, sizeBytes: 174848 }],
    };
    const v2 = migrateSnapshotToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.updatedAt).toBe("2026-01-02");
    expect(v2.entries[0]).toMatchObject({ path: "/GAMES/A.D64", name: "A", type: "disk" });
    expect(v2.entries[0].container).toBeUndefined();
    expect(isChildEntry(v2.entries[0])).toBe(false);
  });

  it("returns a v2 snapshot unchanged", () => {
    const v2 = { version: 2 as const, updatedAt: "x", entries: [] };
    expect(migrateSnapshotToV2(v2)).toBe(v2);
  });
});

describe("inImageSearch — toChildEntry", () => {
  it("maps a directory entry to a child with a compound path and container", () => {
    const entry = toChildEntry("/GAMES/COMPILATION.D64", "d64", 174848, "2026-06-01", dirEntry());
    expect(entry.path).toBe("/GAMES/COMPILATION.D64#2");
    expect(entry.name).toBe("TURRICAN");
    expect(entry.type).toBe("prg");
    expect(entry.sizeBytes).toBe(40 * 254);
    expect(entry.container).toMatchObject({
      diskPath: "/GAMES/COMPILATION.D64",
      diskType: "d64",
      diskSize: 174848,
      diskMtime: "2026-06-01",
      entryIndex: 2,
      fileType: "PRG",
      blocks: 40,
    });
    expect(isChildEntry(entry)).toBe(true);
  });

  it("childPath composes diskPath and index", () => {
    expect(childPath("/A.D64", 5)).toBe("/A.D64#5");
  });
});

describe("inImageSearch — cache freshness + supersede", () => {
  it("hasFreshChildren matches exact (path,size,mtime) and rejects a changed mtime", () => {
    const entries = [child("/A.D64", "ONE", 0, "2026-01-01", 100)];
    expect(hasFreshChildren(entries, "/A.D64", 100, "2026-01-01")).toBe(true);
    expect(hasFreshChildren(entries, "/A.D64", 100, "2026-02-02")).toBe(false);
    expect(hasFreshChildren(entries, "/A.D64", 999, "2026-01-01")).toBe(false);
    expect(hasFreshChildren(entries, "/B.D64", 100, "2026-01-01")).toBe(false);
  });

  it("replaceChildren drops old children of a rewritten disk and keeps others", () => {
    const topLevel: MediaEntryV2 = { path: "/A.D64", name: "A", type: "disk" };
    const otherChild = child("/B.D64", "OTHER", 0);
    const stale = child("/A.D64", "OLD", 0, "2026-01-01");
    const fresh = [child("/A.D64", "NEW1", 0, "2026-09-09"), child("/A.D64", "NEW2", 1, "2026-09-09")];
    const result = replaceChildren([topLevel, otherChild, stale], "/A.D64", fresh);
    expect(result.filter((e) => isChildEntry(e) && e.container.diskPath === "/A.D64").map((e) => e.name)).toEqual([
      "NEW1",
      "NEW2",
    ]);
    expect(result).toContain(topLevel);
    expect(result).toContain(otherChild);
    expect(result).not.toContain(stale);
  });

  it("reconcileChildren drops children whose parent disk left the scanned scope", () => {
    const entries = [
      child("/A.D64", "A0", 0),
      child("/GONE.D64", "G0", 0),
      { path: "/x", name: "x", type: "prg" as const },
    ];
    const result = reconcileChildren(entries, ["/A.D64"]);
    expect(result.map((e) => e.name)).toEqual(["A0", "x"]);
  });
});

describe("inImageSearch — search", () => {
  const entries: MediaEntryV2[] = [
    { path: "/GAMES/COMPILATION.D64", name: "Compilation Disk", type: "disk" },
    child("/GAMES/COMPILATION.D64", "TURRICAN", 0),
    child("/GAMES/COMPILATION.D64", "TURRICAN LEVEL 2", 1),
    child("/GAMES/OTHER.D64", "SOMETHING ELSE", 0),
  ];

  it("ignores children when the toggle is off", () => {
    const hits = searchMediaEntries(entries, "turrican", { searchInsideDisks: false });
    expect(hits).toHaveLength(0);
  });

  it("matches child names when the toggle is on (case-insensitive)", () => {
    const hits = searchMediaEntries(entries, "turrican", { searchInsideDisks: true });
    expect(hits.map((e) => e.name)).toEqual(["TURRICAN", "TURRICAN LEVEL 2"]);
  });

  it("ANDs multiple terms", () => {
    const hits = searchMediaEntries(entries, "turrican level", { searchInsideDisks: true });
    expect(hits.map((e) => e.name)).toEqual(["TURRICAN LEVEL 2"]);
  });

  it("still matches top-level entries regardless of the toggle", () => {
    const hits = searchMediaEntries(entries, "compilation", { searchInsideDisks: false });
    expect(hits.map((e) => e.name)).toEqual(["Compilation Disk"]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchMediaEntries(entries, "   ", { searchInsideDisks: true })).toHaveLength(0);
  });
});
