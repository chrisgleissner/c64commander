/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import type { MediaIndexSnapshot, MediaIndexStorage } from "@/lib/media-index";
import { JsonMediaIndex } from "@/lib/media-index";
import type { HvscFolderListing } from "@/lib/hvsc/hvscTypes";
import { HvscMediaIndexAdapter } from "@/lib/hvsc/hvscMediaIndex";

const createMemoryStorage = (): MediaIndexStorage => {
  let current: MediaIndexSnapshot | null = null;
  return {
    read: async () => current,
    write: async (next) => {
      current = next;
    },
  };
};

describe("HvscMediaIndexAdapter", () => {
  it("scans folder listings and writes entries to the index", async () => {
    const listings: Record<string, HvscFolderListing> = {
      "/": { path: "/", folders: ["/Demos"], songs: [] },
      "/Demos": {
        path: "/Demos",
        folders: [],
        songs: [
          {
            id: 1,
            virtualPath: "/Demos/demo.sid",
            fileName: "demo.sid",
            durationSeconds: 45,
          },
        ],
      },
    };

    const listFolder = async (path: string) => listings[path];
    const storage = createMemoryStorage();
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(storage), listFolder);

    await adapter.scan(["/"]);

    const entry = adapter.queryByPath("/Demos/demo.sid");
    expect(entry?.name).toBe("demo.sid");
    expect(adapter.queryByType("sid")).toHaveLength(1);
  });

  it("normalizes paths and persists entries", async () => {
    const listings: Record<string, HvscFolderListing> = {
      "/": { path: "/", folders: ["/DEMOS"], songs: [] },
      "/DEMOS": {
        path: "/DEMOS",
        folders: ["/DEMOS/Nested"],
        songs: [],
      },
      "/DEMOS/Nested": {
        path: "/DEMOS/Nested",
        folders: [],
        songs: [
          {
            id: 2,
            virtualPath: "/DEMOS/Nested/track.sid",
            fileName: "track.sid",
            durationSeconds: null,
          },
        ],
      },
    };

    const listFolder = async (path: string) => listings[path];
    const storage = createMemoryStorage();
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(storage), listFolder);

    await adapter.scan(["DEMOS"]);
    await adapter.save();

    const snapshot = await storage.read();
    expect(snapshot?.entries).toHaveLength(1);
    expect(adapter.getAll()).toHaveLength(1);
  });

  it("returns paged folder listings without rescanning full index per call", async () => {
    const listings: Record<string, HvscFolderListing> = {
      "/": {
        path: "/",
        folders: ["/DEMOS"],
        songs: [],
      },
      "/DEMOS": {
        path: "/DEMOS",
        folders: ["/DEMOS/A"],
        songs: [
          {
            id: 1,
            virtualPath: "/DEMOS/Alpha.sid",
            fileName: "Alpha.sid",
            durationSeconds: 100,
          },
          {
            id: 2,
            virtualPath: "/DEMOS/Beta.sid",
            fileName: "Beta.sid",
            durationSeconds: 120,
          },
        ],
      },
      "/DEMOS/A": {
        path: "/DEMOS/A",
        folders: [],
        songs: [
          {
            id: 3,
            virtualPath: "/DEMOS/A/Gamma.sid",
            fileName: "Gamma.sid",
            durationSeconds: 140,
          },
        ],
      },
    };

    const adapter = new HvscMediaIndexAdapter(
      new JsonMediaIndex(createMemoryStorage()),
      async (path) => listings[path],
    );
    await adapter.scan(["/"]);

    const page = adapter.queryFolderPage({
      path: "/DEMOS",
      query: "a",
      offset: 0,
      limit: 1,
    });

    expect(page.totalSongs).toBe(2);
    expect(page.songs).toHaveLength(1);
    expect(page.songs[0]?.fileName).toBe("Alpha.sid");
  });

  it("loads from persisted index and skips rescan", async () => {
    const listings: Record<string, HvscFolderListing> = {
      "/": { path: "/", folders: ["/DEMOS"], songs: [] },
      "/DEMOS": {
        path: "/DEMOS",
        folders: [],
        songs: [
          {
            id: 1,
            virtualPath: "/DEMOS/demo.sid",
            fileName: "demo.sid",
            durationSeconds: 45,
          },
        ],
      },
    };

    const listFolder = async (path: string) => listings[path];
    const storage = createMemoryStorage();
    const adapter1 = new HvscMediaIndexAdapter(new JsonMediaIndex(storage), listFolder);
    await adapter1.scan(["/"]);
    await adapter1.save();

    // Create a new adapter with the same storage
    const adapter2 = new HvscMediaIndexAdapter(new JsonMediaIndex(storage), listFolder);
    await adapter2.load();
    const all = adapter2.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it("setEntries updates internal state and browse index", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    adapter.setEntries([
      { path: "/DEMOS/a.sid", name: "a.sid", type: "sid", durationSeconds: 10 },
      { path: "/DEMOS/b.sid", name: "b.sid", type: "sid", durationSeconds: 20 },
    ]);

    expect(adapter.getAll()).toHaveLength(2);
    expect(adapter.queryByPath("/DEMOS/a.sid")?.name).toBe("a.sid");
    expect(adapter.queryByType("sid")).toHaveLength(2);
  });

  it("queryFolderPage uses fallback when no browse snapshot", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    adapter.setEntries([{ path: "/DEMOS/a.sid", name: "a.sid", type: "sid", durationSeconds: 10 }]);

    // Clear internal browse snapshot to trigger fallback path
    (adapter as any).browseSnapshot = null;

    const page = adapter.queryFolderPage({
      path: "/DEMOS",
      offset: 0,
      limit: 50,
    });
    expect(page.totalSongs).toBe(1);
    expect(page.songs[0]?.fileName).toBe("a.sid");
  });

  it("queryFolderPage clamps negative offset and limit", async () => {
    const listings: Record<string, HvscFolderListing> = {
      "/": {
        path: "/",
        folders: [],
        songs: [
          {
            id: 1,
            virtualPath: "/test.sid",
            fileName: "test.sid",
            durationSeconds: 10,
          },
        ],
      },
    };

    const adapter = new HvscMediaIndexAdapter(
      new JsonMediaIndex(createMemoryStorage()),
      async (path) => listings[path],
    );
    await adapter.scan(["/"]);

    const page = adapter.queryFolderPage({ path: "/", offset: -5, limit: -1 });
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(1);
  });

  it("scan visits nested folders recursively without revisiting", async () => {
    let callCount = 0;
    const listings: Record<string, HvscFolderListing> = {
      "/": { path: "/", folders: ["/A", "/A"], songs: [] },
      "/A": {
        path: "/A",
        folders: ["/A/B"],
        songs: [
          {
            id: 1,
            virtualPath: "/A/x.sid",
            fileName: "x.sid",
            durationSeconds: 5,
          },
        ],
      },
      "/A/B": {
        path: "/A/B",
        folders: [],
        songs: [
          {
            id: 2,
            virtualPath: "/A/B/y.sid",
            fileName: "y.sid",
            durationSeconds: 10,
          },
        ],
      },
    };

    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async (path) => {
      callCount++;
      return listings[path];
    });

    await adapter.scan(["/"]);
    expect(adapter.getAll()).toHaveLength(2);
    // '/' visited once, '/A' visited once (deduped), '/A/B' visited once
    expect(callCount).toBe(3);
  });

  it("queryFolderPage fallback at root with sub-directory entries", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    adapter.setEntries([
      { path: "/DEMOS/a.sid", name: "a.sid", type: "sid", durationSeconds: 10 },
      {
        path: "/DEMOS/sub/b.sid",
        name: "b.sid",
        type: "sid",
        durationSeconds: null,
      },
      {
        path: "/UTILS/c.sid",
        name: "c.sid",
        type: "sid",
        durationSeconds: undefined as unknown as null,
      },
    ]);

    (adapter as any).browseSnapshot = null;

    // Root page - prefix becomes '/'
    const rootPage = adapter.queryFolderPage({ path: "/" });
    expect(rootPage.path).toBe("/");
    expect(rootPage.totalFolders).toBeGreaterThan(0);
  });

  it("queryFolderPage fallback filters with query string", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    adapter.setEntries([
      {
        path: "/DEMOS/alpha.sid",
        name: "alpha.sid",
        type: "sid",
        durationSeconds: 10,
      },
      {
        path: "/DEMOS/beta.sid",
        name: "beta.sid",
        type: "sid",
        durationSeconds: 20,
      },
    ]);
    (adapter as any).browseSnapshot = null;

    const page = adapter.queryFolderPage({ path: "/DEMOS", query: "alpha" });
    expect(page.totalSongs).toBe(1);
    expect(page.songs[0]?.fileName).toBe("alpha.sid");

    const noMatch = adapter.queryFolderPage({ path: "/DEMOS", query: "zzz" });
    expect(noMatch.totalSongs).toBe(0);
  });

  it("queryFolderPage fallback skips entries in sub-subdirectories", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    adapter.setEntries([
      { path: "/DEMOS/a.sid", name: "a.sid", type: "sid", durationSeconds: 5 },
      {
        path: "/DEMOS/sub/b.sid",
        name: "b.sid",
        type: "sid",
        durationSeconds: 10,
      },
    ]);
    (adapter as any).browseSnapshot = null;

    // Only direct children of /DEMOS should be returned, not those in /DEMOS/sub/
    const page = adapter.queryFolderPage({ path: "/DEMOS" });
    expect(page.totalSongs).toBe(1); // only a.sid, not b.sid
    expect(page.songs[0]?.fileName).toBe("a.sid");
  });

  it("queryFolderPage fallback handles trailing slashes in path", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    adapter.setEntries([{ path: "/DEMOS/a.sid", name: "a.sid", type: "sid", durationSeconds: 30 }]);
    (adapter as any).browseSnapshot = null;

    // path with trailing slash should be normalized
    const page = adapter.queryFolderPage({ path: "/DEMOS/" });
    expect(page.path).toBe("/DEMOS");
    expect(page.totalSongs).toBe(1);
  });

  it("queryFolderPage with no offset or limit uses defaults", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    adapter.setEntries([{ path: "/DEMOS/a.sid", name: "a.sid", type: "sid", durationSeconds: 10 }]);
    (adapter as any).browseSnapshot = null;

    // No offset/limit → uses defaults (offset=0, limit=200)
    const page = adapter.queryFolderPage({ path: "/DEMOS" });
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(200);
  });

  it("queryByPath returns null when path not found", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));
    adapter.setEntries([{ path: "/DEMOS/a.sid", name: "a.sid", type: "sid", durationSeconds: 10 }]);

    expect(adapter.queryByPath("/notfound.sid")).toBeNull();
  });

  it("getAll falls back to index.getAll when entriesSnapshot is empty", async () => {
    // Use a custom MediaIndex mock whose getAll() always returns entries
    // even without explicit load() call on the adapter
    const mockEntries = [
      {
        path: "/a.sid",
        name: "a.sid",
        type: "sid" as const,
        durationSeconds: 5,
      },
    ];
    const mockIndex = {
      load: async () => {},
      save: async () => {},
      scan: async () => {},
      getAll: () => mockEntries,
      setEntries: () => {},
      queryByType: () => mockEntries,
      queryByPath: (p: string) => mockEntries.find((e) => e.path === p) ?? null,
    };

    const adapter = new HvscMediaIndexAdapter(mockIndex as any, async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));

    // entriesSnapshot is empty (never called setEntries/scan/load)
    expect((adapter as any).entriesSnapshot).toHaveLength(0);
    const entries = adapter.getAll();
    // Falls back to index.getAll()
    expect(entries).toHaveLength(1);
  });

  it("scan without explicit paths starts from root", async () => {
    const scannedPaths: string[] = [];
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async (path) => {
      scannedPaths.push(path);
      return {
        path,
        folders: [],
        songs: [
          {
            id: 1,
            virtualPath: `${path}/a.sid`,
            fileName: "a.sid",
            durationSeconds: 5,
          },
        ],
      };
    });

    await adapter.scan([]);
    expect(scannedPaths).toContain("/");
    expect(adapter.getAll()).toHaveLength(1);
  });

  it("save skips browse snapshot when browseSnapshot is null", async () => {
    const adapter = new HvscMediaIndexAdapter(new JsonMediaIndex(createMemoryStorage()), async () => ({
      path: "/",
      folders: [],
      songs: [],
    }));
    (adapter as any).browseSnapshot = null;
    // Should not throw, just skip saveHvscBrowseIndexSnapshot
    await expect(adapter.save()).resolves.toBeUndefined();
  });
});
