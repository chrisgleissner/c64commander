/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { CATEGORY_OPTIONS } from "@/pages/playFiles/playFilesUtils";
import { DISK_IMAGE_EXTENSIONS, getPlayCategory } from "@/lib/playback/fileTypes";
import {
  PLAYLIST_TYPE_GROUPS,
  describePlaylistTypeFilter,
  isPlaylistTypeGroupShown,
  playlistTypeGroupToggles,
  type PlaylistTypeGroupId,
} from "@/pages/playFiles/playlistTypeGroups";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";

const group = (id: PlaylistTypeGroupId) => PLAYLIST_TYPE_GROUPS.find((entry) => entry.id === id)!;
const groupOfFile = (name: string) =>
  PLAYLIST_TYPE_GROUPS.find((entry) => entry.categories.includes(getPlayCategory(name)!))?.id;

describe("playlist type groups", () => {
  it("put every playable file category in exactly one group", () => {
    const grouped = PLAYLIST_TYPE_GROUPS.flatMap((entry) => entry.categories);
    expect([...grouped].sort()).toEqual([...CATEGORY_OPTIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("file songs under Songs, programs and cartridges under Progs, and every disk image under Disks", () => {
    expect(groupOfFile("tune.sid")).toBe("songs");
    expect(groupOfFile("module.mod")).toBe("songs");
    expect(groupOfFile("game.prg")).toBe("progs");
    expect(groupOfFile("cart.crt")).toBe("progs");
    for (const extension of DISK_IMAGE_EXTENSIONS) {
      expect(groupOfFile(`disk.${extension}`), extension).toBe("disks");
    }
  });

  it("show a group as checked only while all of its categories are shown", () => {
    expect(isPlaylistTypeGroupShown(["sid", "mod", "disk"], group("songs"))).toBe(true);
    expect(isPlaylistTypeGroupShown(["sid", "disk"], group("songs"))).toBe(false);
  });

  it("hide every category of a shown group with one press", () => {
    expect(playlistTypeGroupToggles(CATEGORY_OPTIONS, group("songs"))).toEqual(["sid", "mod"]);
  });

  it("show every category of a hidden group with one press", () => {
    expect(playlistTypeGroupToggles(["disk"], group("progs"))).toEqual(["prg", "crt"]);
  });

  it("complete a partly shown group instead of hiding the part that is still shown", () => {
    expect(playlistTypeGroupToggles(["sid", "disk"], group("songs"))).toEqual(["mod"]);
  });

  it("toggling a group twice through a category toggle returns the filter to where it started", () => {
    const toggle = (filters: PlayFileCategory[], category: PlayFileCategory) =>
      filters.includes(category) ? filters.filter((entry) => entry !== category) : [...filters, category];
    let filters: PlayFileCategory[] = [...CATEGORY_OPTIONS];
    filters = playlistTypeGroupToggles(filters, group("songs")).reduce(toggle, filters);
    expect(filters.sort()).toEqual(["crt", "disk", "prg"]);
    filters = playlistTypeGroupToggles(filters, group("songs")).reduce(toggle, filters);
    expect(filters.sort()).toEqual([...CATEGORY_OPTIONS].sort());
  });

  it("describe the type filter by the groups it shows, and say nothing when it shows every type", () => {
    expect(describePlaylistTypeFilter(CATEGORY_OPTIONS)).toBeNull();
    expect(describePlaylistTypeFilter(["prg", "crt", "disk"])).toBe("Progs, Disks");
    expect(describePlaylistTypeFilter([])).toBe("No types");
  });
});
