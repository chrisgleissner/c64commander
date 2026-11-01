/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { moveAfterCurrent, moveItem } from "@/pages/playFiles/playlistReorder";

type Row = { id: string };

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const ids = (items: Row[]) => items.map((item) => item.id);

describe("moveItem", () => {
  it("moves a row one place down and one place up", () => {
    const playlist = rows("a", "b", "c", "d");

    expect(ids(moveItem(playlist, "b", 1, -1).items)).toEqual(["a", "c", "b", "d"]);
    expect(ids(moveItem(playlist, "c", -1, -1).items)).toEqual(["a", "c", "b", "d"]);
  });

  it("does not change the input array", () => {
    const playlist = rows("a", "b", "c");

    moveItem(playlist, "a", 1, -1);

    expect(ids(playlist)).toEqual(["a", "b", "c"]);
  });

  it("returns the input array unchanged when the first row moves up", () => {
    const playlist = rows("a", "b", "c");

    const result = moveItem(playlist, "a", -1, 1);

    expect(result.items).toBe(playlist);
    expect(result.currentIndex).toBe(1);
  });

  it("returns the input array unchanged when the last row moves down", () => {
    const playlist = rows("a", "b", "c");

    const result = moveItem(playlist, "c", 1, 0);

    expect(result.items).toBe(playlist);
    expect(result.currentIndex).toBe(0);
  });

  it("returns the input array unchanged for an unknown id and for a zero delta", () => {
    const playlist = rows("a", "b", "c");

    expect(moveItem(playlist, "missing", 1, 1).items).toBe(playlist);
    expect(moveItem(playlist, "b", 0, 1).items).toBe(playlist);
  });

  it("keeps the current index on the playing row when that row moves", () => {
    const playlist = rows("a", "b", "c", "d");

    const down = moveItem(playlist, "b", 1, 1);
    expect(ids(down.items)).toEqual(["a", "c", "b", "d"]);
    expect(down.currentIndex).toBe(2);

    const up = moveItem(playlist, "b", -1, 1);
    expect(ids(up.items)).toEqual(["b", "a", "c", "d"]);
    expect(up.currentIndex).toBe(0);
  });

  it("moves the current index to follow the playing row when another row moves across it", () => {
    const playlist = rows("a", "b", "c", "d");

    const fromBelow = moveItem(playlist, "c", -1, 1);
    expect(ids(fromBelow.items)).toEqual(["a", "c", "b", "d"]);
    expect(fromBelow.currentIndex).toBe(2);

    const fromAbove = moveItem(playlist, "a", 1, 1);
    expect(ids(fromAbove.items)).toEqual(["b", "a", "c", "d"]);
    expect(fromAbove.currentIndex).toBe(0);
  });

  it("leaves the current index alone when the move is on one side of the playing row", () => {
    const playlist = rows("a", "b", "c", "d");

    expect(moveItem(playlist, "c", 1, 0).currentIndex).toBe(0);
    expect(moveItem(playlist, "a", 1, 3).currentIndex).toBe(3);
  });

  it("keeps an empty selection empty", () => {
    const playlist = rows("a", "b", "c");

    expect(moveItem(playlist, "b", 1, -1).currentIndex).toBe(-1);
  });
});

describe("moveAfterCurrent", () => {
  it("moves a row from below to directly after the playing row", () => {
    const playlist = rows("a", "b", "c", "d", "e");

    const result = moveAfterCurrent(playlist, 1, "e");

    expect(ids(result.items)).toEqual(["a", "b", "e", "c", "d"]);
    expect(result.currentIndex).toBe(1);
  });

  it("moves a row from above the playing row to directly after it and shifts the current index", () => {
    const playlist = rows("a", "b", "c", "d", "e");

    const result = moveAfterCurrent(playlist, 3, "a");

    expect(ids(result.items)).toEqual(["b", "c", "d", "a", "e"]);
    expect(result.currentIndex).toBe(2);
  });

  it("moves a row to the end when the playing row is last", () => {
    const playlist = rows("a", "b", "c");

    const result = moveAfterCurrent(playlist, 2, "a");

    expect(ids(result.items)).toEqual(["b", "c", "a"]);
    expect(result.currentIndex).toBe(1);
  });

  it("moves a row to the top when nothing is playing", () => {
    const playlist = rows("a", "b", "c");

    const result = moveAfterCurrent(playlist, 2, "c", false);

    expect(ids(result.items)).toEqual(["c", "a", "b"]);
    expect(result.currentIndex).toBe(0);
  });

  it("moves a row to the top when there is no current row", () => {
    const playlist = rows("a", "b", "c");

    const result = moveAfterCurrent(playlist, -1, "b");

    expect(ids(result.items)).toEqual(["b", "a", "c"]);
    expect(result.currentIndex).toBe(-1);
  });

  it("returns the input array unchanged when the row is already directly after the playing row", () => {
    const playlist = rows("a", "b", "c");

    const result = moveAfterCurrent(playlist, 0, "b");

    expect(result.items).toBe(playlist);
    expect(result.currentIndex).toBe(0);
  });

  it("returns the input array unchanged when the row is the playing row", () => {
    const playlist = rows("a", "b", "c");

    expect(moveAfterCurrent(playlist, 1, "b").items).toBe(playlist);
  });

  it("returns the input array unchanged when the top row is moved to the top with nothing playing", () => {
    const playlist = rows("a", "b", "c");

    expect(moveAfterCurrent(playlist, 1, "a", false).items).toBe(playlist);
  });

  it("returns the input array unchanged for an unknown id", () => {
    const playlist = rows("a", "b", "c");

    expect(moveAfterCurrent(playlist, 0, "missing").items).toBe(playlist);
  });
});
