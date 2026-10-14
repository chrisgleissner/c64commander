/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import {
  __parseMediaIndexSnapshotForTest,
  __parseMediaIndexSnapshotSlicedForTest,
} from "@/lib/hvsc/hvscBrowseIndexStore";
import { buildFoldersFromSongs, buildFoldersFromSongsSliced } from "@/lib/hvsc/hvscBrowseFolders";

const persisted = JSON.stringify({
  version: 2,
  updatedAt: "2026-01-01T00:00:00.000Z",
  entries: [
    { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", type: "sid", durationSeconds: 221 },
    {
      path: "/MUSICIANS/D/Daglish_Ben/Zoids.sid",
      name: "Zoids.sid",
      type: "sid",
      durationSeconds: 130,
      durations: [130, 95],
      title: "Zoids",
      author: "Ben Daglish",
      released: "1986 Mastertronic",
      hydrated: true,
    },
    { path: "/DEMOS/readme.txt", name: "readme.txt", type: "file" },
  ],
});

const countingSlice = () => {
  const calls = { count: 0 };
  return {
    calls,
    slice: {
      due: () => {
        calls.count += 1;
        return false;
      },
      yield: async () => {},
    },
  };
};

const noSlice = { due: () => false, yield: async () => {} };

const withoutTimestamp = <T extends { updatedAt: string }>(snapshot: T) => ({ ...snapshot, updatedAt: "" });

describe("parseMediaIndexSnapshotSliced", () => {
  it("builds the same snapshot as the plain parse, including restored hydrated metadata", async () => {
    const plain = __parseMediaIndexSnapshotForTest(persisted);
    const { slice } = countingSlice();
    const sliced = await __parseMediaIndexSnapshotSlicedForTest(persisted, slice);

    expect(sliced).not.toBeNull();
    expect(withoutTimestamp(sliced!)).toEqual(withoutTimestamp(plain!));
    expect(sliced!.songs["/MUSICIANS/D/Daglish_Ben/Zoids.sid"].metadataStatus).toBe("hydrated");
  });

  it("asks for a slice for every song it builds and every song it restores", async () => {
    const { calls, slice } = countingSlice();
    await __parseMediaIndexSnapshotSlicedForTest(persisted, slice);

    expect(calls.count).toBeGreaterThanOrEqual(2 + 2 + 2);
  });

  it("returns null for text that is not a snapshot, as the plain parse does", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await __parseMediaIndexSnapshotSlicedForTest(null, noSlice)).toBeNull();
    expect(await __parseMediaIndexSnapshotSlicedForTest("{not json", noSlice)).toBeNull();
    expect(await __parseMediaIndexSnapshotSlicedForTest(JSON.stringify({ entries: "no" }), noSlice)).toBeNull();
    warn.mockRestore();
  });
});

describe("buildFoldersFromSongsSliced", () => {
  it("lists the same folders as the plain build", async () => {
    const snapshot = __parseMediaIndexSnapshotForTest(persisted)!;
    expect(await buildFoldersFromSongsSliced(snapshot.songs, noSlice)).toEqual(buildFoldersFromSongs(snapshot.songs));
  });
});
