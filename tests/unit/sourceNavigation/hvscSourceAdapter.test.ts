/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHvscSourceLocation } from "@/lib/sourceNavigation/hvscSourceAdapter";
import { getHvscFolderListing, getHvscFolderListingPaged } from "@/lib/hvsc";

vi.mock("@/lib/hvsc", () => ({
  getHvscFolderListing: vi.fn(),
  getHvscFolderListingPaged: vi.fn(),
}));

describe("hvscSourceAdapter", () => {
  beforeEach(() => {
    vi.mocked(getHvscFolderListing).mockReset();
    vi.mocked(getHvscFolderListingPaged).mockReset();
  });

  it("lists folders and songs sorted by name", async () => {
    vi.mocked(getHvscFolderListing).mockResolvedValue({
      path: "/ROOT",
      folders: ["/ROOT/B", "/ROOT/A"],
      songs: [
        { virtualPath: "/ROOT/z.sid", fileName: "z.sid" },
        { virtualPath: "/ROOT/a.sid", fileName: "a.sid" },
      ],
    });

    const source = createHvscSourceLocation("/ROOT");
    const entries = await source.listEntries("/ROOT");

    expect(entries.map((entry) => entry.name)).toEqual(["A", "a.sid", "B", "z.sid"]);
    expect(entries[0]).toMatchObject({ type: "dir", path: "/ROOT/A" });
  });

  it("walks folders recursively and collects songs", async () => {
    vi.mocked(getHvscFolderListingPaged).mockImplementation(async ({ path }: { path: string }) => {
      if (path === "/ROOT") {
        return {
          path,
          folders: ["/ROOT/Sub"],
          songs: [{ virtualPath: "/ROOT/root.sid", fileName: "root.sid" }],
          totalFolders: 1,
          totalSongs: 1,
          offset: 0,
          limit: 200,
        };
      }
      if (path === "/ROOT/Sub") {
        return {
          path,
          folders: [],
          songs: [{ virtualPath: "/ROOT/Sub/deep.sid", fileName: "deep.sid" }],
          totalFolders: 0,
          totalSongs: 1,
          offset: 0,
          limit: 200,
        };
      }
      return { path, folders: [], songs: [], totalFolders: 0, totalSongs: 0, offset: 0, limit: 200 };
    });

    const source = createHvscSourceLocation("/ROOT");
    const entries = await source.listFilesRecursive("/ROOT");

    expect(entries).toEqual([
      { type: "file", name: "root.sid", path: "/ROOT/root.sid" },
      { type: "file", name: "deep.sid", path: "/ROOT/Sub/deep.sid" },
    ]);
    expect(vi.mocked(getHvscFolderListing)).not.toHaveBeenCalled();
  });

  it("preserves HVSC duration and subsong metadata in paged listings", async () => {
    vi.mocked(getHvscFolderListingPaged).mockResolvedValue({
      path: "/ROOT",
      folders: ["/ROOT/Collections"],
      songs: [
        {
          id: 12,
          virtualPath: "/ROOT/demo.sid",
          fileName: "demo.sid",
          durationSeconds: 87,
          sidMetadata: {
            magicId: "PSID",
            version: 2,
            songs: 4,
            startSong: 2,
            clock: "pal",
            sid1Model: "mos6581",
            sid2Model: null,
            sid3Model: null,
            sid2Adress: null,
            sid2Address: null,
            name: "Demo",
            author: "Coder",
            released: "1987",
            rsidValid: true,
            parserWarnings: [],
          },
          trackSubsongs: [
            { songNr: 2, isDefault: true },
            { songNr: 3, isDefault: false },
          ],
        },
      ],
      totalFolders: 1,
      totalSongs: 3,
      offset: 0,
      limit: 50,
      query: "demo",
    });

    const source = createHvscSourceLocation("/ROOT");
    const page = await source.listEntriesPage?.({ path: "/ROOT", query: "demo", offset: 0, limit: 50 });

    expect(page).toEqual({
      entries: [
        { type: "dir", name: "Collections", path: "/ROOT/Collections" },
        {
          type: "file",
          name: "demo.sid",
          path: "/ROOT/demo.sid",
          durationMs: 87_000,
          songNr: 2,
          subsongCount: 2,
        },
      ],
      totalCount: 4,
      nextOffset: 1,
    });
  });

  it("preserves zero-second HVSC durations instead of dropping them", async () => {
    vi.mocked(getHvscFolderListingPaged).mockResolvedValue({
      path: "/ROOT",
      folders: [],
      songs: [
        {
          virtualPath: "/ROOT/silent.sid",
          fileName: "silent.sid",
          durationSeconds: 0,
        },
      ],
      totalFolders: 0,
      totalSongs: 1,
      offset: 0,
      limit: 50,
    });

    const source = createHvscSourceLocation("/ROOT");
    const page = await source.listEntriesPage?.({ path: "/ROOT", offset: 0, limit: 50 });

    expect(page?.entries).toEqual([
      {
        type: "file",
        name: "silent.sid",
        path: "/ROOT/silent.sid",
        durationMs: 0,
      },
    ]);
  });

  it("aborts recursive listing when signal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = createHvscSourceLocation("/ROOT");

    await expect(source.listFilesRecursive("/ROOT", { signal: controller.signal })).rejects.toThrow("Aborted");
  });
});
