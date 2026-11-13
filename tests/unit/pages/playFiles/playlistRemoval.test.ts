/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { captureRemovedRows, describeRemoval, restoreRemovedRows } from "@/pages/playFiles/playlistRemoval";
import type { PlaylistItem } from "@/pages/playFiles/types";

const buildItem = (name: string): PlaylistItem => ({
  id: `local:/Music/${name}.sid`,
  request: { source: "local", path: `/Music/${name}.sid` },
  category: "sid",
  label: `${name}.sid`,
  path: `/Music/${name}.sid`,
  addedAt: "2026-02-12T00:00:00.000Z",
  status: "ready",
  unavailableReason: null,
});

const playlist = ["a", "b", "c", "d", "e"].map(buildItem);
const names = (items: PlaylistItem[]) => items.map((item) => item.label.replace(".sid", ""));
const idsOf = (...letters: string[]) => new Set(letters.map((letter) => buildItem(letter).id));
const removeIds = (items: PlaylistItem[], ids: Set<string>) => items.filter((item) => !ids.has(item.id));

describe("playlistRemoval", () => {
  it("captures the removed rows with the positions they held", () => {
    const removed = captureRemovedRows(playlist, idsOf("b", "e"));

    expect(removed.map(({ item, index }) => [item.label, index])).toEqual([
      ["b.sid", 1],
      ["e.sid", 4],
    ]);
  });

  it("captures nothing for an id the playlist does not hold", () => {
    expect(captureRemovedRows(playlist, idsOf("z"))).toEqual([]);
  });

  it("restores scattered rows at their original positions", () => {
    const removed = captureRemovedRows(playlist, idsOf("a", "c", "d"));
    const remaining = removeIds(playlist, idsOf("a", "c", "d"));

    expect(names(restoreRemovedRows(remaining, -1, removed).items)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("restores the last row at the end", () => {
    const removed = captureRemovedRows(playlist, idsOf("e"));

    expect(names(restoreRemovedRows(removeIds(playlist, idsOf("e")), -1, removed).items)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("restores the only row of an emptied playlist", () => {
    const single = [buildItem("a")];
    const removed = captureRemovedRows(single, idsOf("a"));

    expect(names(restoreRemovedRows([], -1, removed).items)).toEqual(["a"]);
  });

  it("restores the whole playlist after Clear playlist, in order", () => {
    const removed = captureRemovedRows(playlist, new Set(playlist.map((item) => item.id)));

    expect(names(restoreRemovedRows([], -1, removed).items)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps rows added after the removal and clamps positions past the new end", () => {
    const removed = captureRemovedRows(playlist, idsOf("d", "e"));
    const afterAdd = [...removeIds(playlist, idsOf("d", "e")), buildItem("x")];

    expect(names(restoreRemovedRows(afterAdd, -1, removed).items)).toEqual(["a", "b", "c", "d", "e", "x"]);
  });

  it("keeps a row added in the middle after the removal", () => {
    const removed = captureRemovedRows(playlist, idsOf("b"));
    const afterAdd = [buildItem("a"), buildItem("x"), buildItem("c"), buildItem("d"), buildItem("e")];

    expect(names(restoreRemovedRows(afterAdd, -1, removed).items)).toEqual(["a", "b", "x", "c", "d", "e"]);
  });

  it("does not duplicate a row that was added again after it was removed", () => {
    const removed = captureRemovedRows(playlist, idsOf("b"));
    const readded = [...removeIds(playlist, idsOf("b")), buildItem("b")];

    expect(names(restoreRemovedRows(readded, -1, removed).items)).toEqual(["a", "c", "d", "e", "b"]);
  });

  it("keeps the current index on the same row when rows are restored above it", () => {
    const removed = captureRemovedRows(playlist, idsOf("a", "b"));
    const remaining = removeIds(playlist, idsOf("a", "b"));

    expect(restoreRemovedRows(remaining, 1, removed).currentIndex).toBe(3);
  });

  it("leaves the current index at none when nothing is current, so no playback is implied", () => {
    const removed = captureRemovedRows(playlist, idsOf("c"));
    const result = restoreRemovedRows(removeIds(playlist, idsOf("c")), -1, removed);

    expect(result.currentIndex).toBe(-1);
  });

  it("describes a removal by its row count", () => {
    expect(describeRemoval(1)).toBe("Removed 1 item");
    expect(describeRemoval(3)).toBe("Removed 3 items");
  });
});
