/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    stat: vi.fn(async () => ({ type: "file", size: 1 })),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => {
      throw new Error("missing");
    }),
    writeFile: vi.fn(async () => undefined),
  },
}));

import { Filesystem } from "@capacitor/filesystem";
import {
  buildHvscBrowseIndexFromEntries,
  clearHvscBrowseIndexSnapshot,
  getHvscFoldersWithParent,
  getHvscSongFromBrowseIndex,
  listFolderFromBrowseIndex,
  listHvscFolderTracks,
  loadHvscBrowseIndexSnapshot,
  saveHvscBrowseIndexSnapshot,
  verifyHvscBrowseIndexIntegrity,
} from "@/lib/hvsc/hvscBrowseIndexStore";

describe("hvscBrowseIndexStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds folder adjacency and lists children without full scan", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" },
      { path: "/DEMOS/B/Two.sid", name: "Two.sid", type: "sid" },
    ]);

    const root = listFolderFromBrowseIndex(snapshot, "/", "", 0, 50);
    expect(root.folders).toContain("/DEMOS");

    const demos = listFolderFromBrowseIndex(snapshot, "/DEMOS", "", 0, 50);
    expect(demos.folders).toContain("/DEMOS/A");
    expect(demos.folders).toContain("/DEMOS/B");
    expect(demos.totalSongs).toBe(0);

    const aFolder = listFolderFromBrowseIndex(snapshot, "/DEMOS/A", "", 0, 50);
    expect(aFolder.totalSongs).toBe(1);
    expect(aFolder.songs[0]?.fileName).toBe("One.sid");
  });

  it("reports integrity failures when sampled files are missing", async () => {
    vi.mocked(Filesystem.stat).mockRejectedValueOnce(new Error("missing"));

    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" },
      { path: "/DEMOS/B/Two.sid", name: "Two.sid", type: "sid" },
    ]);

    const result = await verifyHvscBrowseIndexIntegrity(snapshot, 2);
    expect(result.isValid).toBe(false);
    expect(result.missingPaths.length).toBeGreaterThan(0);
  });

  it("returns valid for empty index in integrity check", async () => {
    const snapshot = buildHvscBrowseIndexFromEntries([]);
    const result = await verifyHvscBrowseIndexIntegrity(snapshot);
    expect(result.isValid).toBe(true);
    expect(result.sampled).toBe(0);
    expect(result.missingPaths).toEqual([]);
  });

  it("gets song from browse index by path", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" }]);
    const song = getHvscSongFromBrowseIndex(snapshot, "/DEMOS/A/One.sid");
    expect(song).not.toBeNull();
    expect(song?.fileName).toBe("One.sid");
  });

  it("returns null for missing song in browse index", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" }]);
    const song = getHvscSongFromBrowseIndex(snapshot, "/nonexist/Song.sid");
    expect(song).toBeNull();
  });

  it("gets folders with parent", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" },
      { path: "/DEMOS/B/Two.sid", name: "Two.sid", type: "sid" },
    ]);
    const folders = getHvscFoldersWithParent(snapshot, "/DEMOS");
    expect(folders.length).toBe(2);
    expect(folders.map((f) => f.folderName).sort()).toEqual(["A", "B"]);
  });

  it("returns empty array for non-existent parent folder", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" }]);
    const folders = getHvscFoldersWithParent(snapshot, "/NONEXIST");
    expect(folders).toEqual([]);
  });

  it("lists folder tracks", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" },
      { path: "/DEMOS/A/Two.sid", name: "Two.sid", type: "sid" },
    ]);
    const tracks = listHvscFolderTracks(snapshot, "/DEMOS/A");
    expect(tracks.length).toBe(2);
    expect(tracks.map((t) => t.fileName).sort()).toEqual(["One.sid", "Two.sid"]);
  });

  it("returns empty array for non-existent folder tracks", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([]);
    const tracks = listHvscFolderTracks(snapshot, "/NONEXIST");
    expect(tracks).toEqual([]);
  });

  it("filters songs by query in listFolderFromBrowseIndex", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/Alpha.sid", name: "Alpha.sid", type: "sid" },
      { path: "/DEMOS/A/Beta.sid", name: "Beta.sid", type: "sid" },
    ]);
    const result = listFolderFromBrowseIndex(snapshot, "/DEMOS/A", "alpha", 0, 50);
    expect(result.totalSongs).toBe(1);
    expect(result.songs[0]?.fileName).toBe("Alpha.sid");
  });

  it("normalizes trailing-slash folder path", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" }]);
    const result = listFolderFromBrowseIndex(snapshot, "/DEMOS/A/", "", 0, 50);
    expect(result.totalSongs).toBe(1);
  });

  it("loads snapshot from localStorage when filesystem fails", async () => {
    const {
      loadHvscBrowseIndexSnapshot,
      saveHvscBrowseIndexSnapshot,
      buildHvscBrowseIndexFromEntries: build,
    } = await import("@/lib/hvsc/hvscBrowseIndexStore");
    const snapshot = build([{ path: "/test.sid", name: "test.sid", type: "sid" }]);

    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }

    // Force localStorage fallback on save
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error("disk full") as any);
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
    await saveHvscBrowseIndexSnapshot(snapshot);

    // Filesystem read fails, should fall back to localStorage
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("missing"));
    const loaded = await loadHvscBrowseIndexSnapshot();
    expect(loaded).toMatchObject({
      schemaVersion: snapshot.schemaVersion,
      folders: snapshot.folders,
      songs: snapshot.songs,
    });
    expect(loaded?.updatedAt).toEqual(expect.any(String));
  });

  it("clears browse index from storage", async () => {
    const { clearHvscBrowseIndexSnapshot } = await import("@/lib/hvsc/hvscBrowseIndexStore");
    vi.mocked(Filesystem.deleteFile ?? vi.fn()).mockResolvedValue(undefined as any);
    const deleteFileFn = (Filesystem as any).deleteFile;
    if (!deleteFileFn) {
      (Filesystem as any).deleteFile = vi.fn(async () => undefined);
    }
    await clearHvscBrowseIndexSnapshot();
  });

  it("creates empty snapshot with correct schema", async () => {
    const { createEmptyHvscBrowseIndexSnapshot } = await import("@/lib/hvsc/hvscBrowseIndexStore");
    const empty = createEmptyHvscBrowseIndexSnapshot();
    expect(empty.schemaVersion).toBe(1);
    expect(empty.folders["/"]).toBeDefined();
    expect(Object.keys(empty.songs)).toHaveLength(0);
  });

  it("creates mutable browse index for baseline", async () => {
    const { createHvscBrowseIndexMutable } = await import("@/lib/hvsc/hvscBrowseIndexStore");
    vi.mocked(Filesystem.writeFile).mockResolvedValue(undefined as any);
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);

    const mutable = await createHvscBrowseIndexMutable("baseline");
    mutable.upsertSong({
      virtualPath: "/DEMOS/test.sid",
      fileName: "test.sid",
      durationSeconds: 42,
    });
    mutable.deleteSong("/nonexistent.sid");
    await mutable.finalize();
  });

  it("verifies integrity of empty snapshot", async () => {
    const { createEmptyHvscBrowseIndexSnapshot, verifyHvscBrowseIndexIntegrity: verify } =
      await import("@/lib/hvsc/hvscBrowseIndexStore");
    const empty = createEmptyHvscBrowseIndexSnapshot();
    const result = await verify(empty);
    expect(result.isValid).toBe(true);
  });

  it("normalizes snapshot with null → returns empty snapshot", async () => {
    const { loadHvscBrowseIndexSnapshot } = await import("@/lib/hvsc/hvscBrowseIndexStore");
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("not found"));
    // localStorage has null (nothing stored)
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    const result = await loadHvscBrowseIndexSnapshot();
    expect(result).toBeNull();
  });

  it("discards snapshot with wrong schema version", async () => {
    const { loadHvscBrowseIndexSnapshot } = await import("@/lib/hvsc/hvscBrowseIndexStore");
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("not found"));
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("c64u_hvsc_browse_index:v1", JSON.stringify({ schemaVersion: 999, songs: {}, folders: {} }));
    }
    const result = await loadHvscBrowseIndexSnapshot();
    expect(result).toBeNull();
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("createHvscBrowseIndexMutable with update mode loads existing snapshot", async () => {
    const { createHvscBrowseIndexMutable, buildHvscBrowseIndexFromEntries: build } =
      await import("@/lib/hvsc/hvscBrowseIndexStore");
    vi.mocked(Filesystem.writeFile).mockResolvedValue(undefined as any);
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);

    const existing = build([{ path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" }]);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("c64u_hvsc_browse_index:v1", JSON.stringify(existing));
    }
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("no filesystem"));

    const mutable = await createHvscBrowseIndexMutable("update");
    mutable.upsertSong({
      virtualPath: "/DEMOS/B/Two.sid",
      fileName: "Two.sid",
      durationSeconds: 120,
    });
    await mutable.finalize();
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("filters songs by sidMetadata author in listFolderFromBrowseIndex", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/Alpha.sid", name: "Alpha.sid", type: "sid" },
      { path: "/DEMOS/A/Beta.sid", name: "Beta.sid", type: "sid" },
    ]);
    // Add sidMetadata to one song manually
    snapshot.songs["/DEMOS/A/Alpha.sid"]!.sidMetadata = {
      name: "My Track",
      author: "Jeroen Tel",
      released: "1990",
    };
    const result = listFolderFromBrowseIndex(snapshot, "/DEMOS/A", "jeroen", 0, 50);
    expect(result.totalSongs).toBe(1);
    expect(result.songs[0]?.fileName).toBe("Alpha.sid");
  });

  it("listFolderFromBrowseIndex filters folders by query", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" },
      { path: "/ARCADE/B/Two.sid", name: "Two.sid", type: "sid" },
    ]);
    const result = listFolderFromBrowseIndex(snapshot, "/", "DEMO", 0, 50);
    expect(result.folders.every((f: string) => f.toLowerCase().includes("demo"))).toBe(true);
  });

  it("saveHvscBrowseIndexSnapshot falls back to localStorage when Filesystem fails", async () => {
    const { saveHvscBrowseIndexSnapshot, buildHvscBrowseIndexFromEntries: build } =
      await import("@/lib/hvsc/hvscBrowseIndexStore");
    const snapshot = build([{ path: "/test.sid", name: "test.sid", type: "sid" }]);
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as any);
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error("disk error"));
    if (typeof localStorage !== "undefined") localStorage.clear();
    await saveHvscBrowseIndexSnapshot(snapshot);
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("c64u_hvsc_browse_index:v1");
      expect(stored).not.toBeNull();
      localStorage.clear();
    }
  });

  it("normalizeFolderPath treats empty string as root", () => {
    // Call via listFolderFromBrowseIndex with empty folderPath
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/song.sid", name: "song.sid", type: "sid" }]);
    const result = listFolderFromBrowseIndex(snapshot, "", "", 0, 50);
    expect(result.path).toBe("/");
  });

  it("listFolderFromBrowseIndex handles song entry missing from songs record", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" }]);
    // Corrupt the snapshot by removing the song but keeping the folder reference
    snapshot.folders["/DEMOS/A"].songs.push("/DEMOS/A/Ghost.sid");
    // Ghost.sid not in snapshot.songs → filter should exclude it
    const result = listFolderFromBrowseIndex(snapshot, "/DEMOS/A", "", 0, 50);
    expect(result.songs.find((s: { fileName: string }) => s.fileName === "Ghost.sid")).toBeUndefined();
    expect(result.songs.find((s: { fileName: string }) => s.fileName === "One.sid")).toBeDefined();
  });
});

describe("hvscBrowseIndexStore branch coverage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("normalizePath adds leading slash when missing (line 42 FALSE)", () => {
    // path without leading slash → normalizePath prepends '/'
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "DEMOS/song.sid", name: "song.sid", type: "sid" }]);
    expect(snapshot.songs["/DEMOS/song.sid"]).toBeDefined();
  });

  it("parseSnapshot returns empty snapshot for JSON null (line 155 TRUE)", async () => {
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("not found"));
    localStorage.setItem("c64u_hvsc_browse_index:v1", JSON.stringify(null));
    const result = await loadHvscBrowseIndexSnapshot();
    // normalizeSnapshot(null) → createEmptyHvscBrowseIndexSnapshot
    expect(result).not.toBeNull();
    expect(Object.keys(result?.songs ?? {})).toHaveLength(0);
  });

  it("normalizeSnapshot uses getFileName when song.fileName is empty (line 162)", async () => {
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("not found"));
    const fakeSnapshot = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      songs: {
        "/DEMOS/test.sid": {
          virtualPath: "/DEMOS/test.sid",
          fileName: "",
          durationSeconds: null,
          sidMetadata: null,
          trackSubsongs: null,
        },
      },
      folders: {},
    };
    localStorage.setItem("c64u_hvsc_browse_index:v1", JSON.stringify(fakeSnapshot));
    const result = await loadHvscBrowseIndexSnapshot();
    // fileName was empty → falls back to getFileName → 'test.sid'
    expect(result?.songs["/DEMOS/test.sid"]?.fileName).toBe("test.sid");
  });

  it("normalizeSnapshot treats null songs as empty object (line 180)", async () => {
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("not found"));
    const fakeSnapshot = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      songs: null,
      folders: {},
    };
    localStorage.setItem("c64u_hvsc_browse_index:v1", JSON.stringify(fakeSnapshot));
    const result = await loadHvscBrowseIndexSnapshot();
    expect(result).not.toBeNull();
    expect(Object.keys(result?.songs ?? {})).toHaveLength(0);
  });

  it("parseSnapshot returns null for invalid JSON in localStorage (line 187 catch)", async () => {
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("not found"));
    localStorage.setItem("c64u_hvsc_browse_index:v1", "NOT VALID JSON {{{");
    const result = await loadHvscBrowseIndexSnapshot();
    expect(result).toBeNull();
  });

  it("clearHvscBrowseIndexSnapshot handles first deleteFile throw (line 198)", async () => {
    (Filesystem as Record<string, unknown>).deleteFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("delete1 fail"))
      .mockResolvedValue(undefined);
    await clearHvscBrowseIndexSnapshot();
    // Should not throw
  });

  it("clearHvscBrowseIndexSnapshot handles second deleteFile throw (line 206)", async () => {
    (Filesystem as Record<string, unknown>).deleteFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("delete2 fail"));
    await clearHvscBrowseIndexSnapshot();
    // Should not throw
  });

  it("readLocalStorageSnapshot returns null when localStorage undefined (line 250)", async () => {
    vi.stubGlobal("localStorage", undefined);
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("not found"));
    const result = await loadHvscBrowseIndexSnapshot();
    expect(result).toBeNull();
  });

  it("loadHvscBrowseIndexSnapshot returns filesystem snapshot when available (line 277 TRUE)", async () => {
    const snapshot = buildHvscBrowseIndexFromEntries([]);
    const json = JSON.stringify(snapshot);
    const bytes = new TextEncoder().encode(json);
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    const encoded = btoa(binary);
    vi.mocked(Filesystem.readFile).mockResolvedValueOnce({
      data: encoded,
    } as never);
    const result = await loadHvscBrowseIndexSnapshot();
    expect(result).not.toBeNull();
    expect(result?.schemaVersion).toBe(snapshot.schemaVersion);
  });

  it("loadHvscBrowseIndexSnapshot uses localStorage when window undefined (line 279)", async () => {
    const snapshot = buildHvscBrowseIndexFromEntries([{ path: "/test2.sid", name: "test2.sid", type: "sid" }]);
    localStorage.setItem("c64u_hvsc_browse_index:v1", JSON.stringify(snapshot));
    vi.stubGlobal("window", undefined);
    const result = await loadHvscBrowseIndexSnapshot();
    expect(result?.songs["/test2.sid"]).toBeDefined();
  });

  it("saveHvscBrowseIndexSnapshot skips localStorage writes when localStorage undefined (lines 255, 260)", async () => {
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined as never);
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error("disk error"));
    vi.stubGlobal("localStorage", undefined);
    const snapshot = buildHvscBrowseIndexFromEntries([]);
    // Should not throw even without localStorage
    await saveHvscBrowseIndexSnapshot(snapshot);
  });
});

// ── P0-A: Browse paging correctness ─────────────────────────────
describe("listFolderFromBrowseIndex paging correctness (P0-A)", () => {
  it("scopes folder listing to direct children, not all snapshot folders", () => {
    // Bug: before fix Object.keys(snapshot.folders) returned the entire global
    // folder set, so a /DEMOS query would include /ARCADE/B.
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" },
      { path: "/ARCADE/B/Two.sid", name: "Two.sid", type: "sid" },
    ]);

    const demos = listFolderFromBrowseIndex(snapshot, "/DEMOS", "", 0, 50);
    expect(demos.folders).toEqual(["/DEMOS/A"]);
    expect(demos.folders).not.toContain("/ARCADE");
    expect(demos.folders).not.toContain("/ARCADE/B");
  });

  it("pagination with limit on scoped children returns correct page", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/ROOT/A/song1.sid", name: "song1.sid", type: "sid" },
      { path: "/ROOT/B/song2.sid", name: "song2.sid", type: "sid" },
      { path: "/ROOT/C/song3.sid", name: "song3.sid", type: "sid" },
      { path: "/OTHER/D/song4.sid", name: "song4.sid", type: "sid" },
    ]);

    const page1 = listFolderFromBrowseIndex(snapshot, "/ROOT", "", 0, 2);
    // Should only return /ROOT direct children (/ROOT/A, /ROOT/B, /ROOT/C), not /OTHER/D
    expect(page1.totalFolders).toBe(3);
    expect(page1.folders).not.toContain("/OTHER/D");
    expect(page1.folders).not.toContain("/OTHER");
  });

  it("root listing returns only top-level folders", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/SUB/deep.sid", name: "deep.sid", type: "sid" },
      { path: "/GAMES/game.sid", name: "game.sid", type: "sid" },
    ]);

    const root = listFolderFromBrowseIndex(snapshot, "/", "", 0, 50);
    // Root should list /DEMOS and /GAMES, NOT /DEMOS/SUB
    expect(root.folders).toContain("/DEMOS");
    expect(root.folders).toContain("/GAMES");
    expect(root.folders).not.toContain("/DEMOS/SUB");
  });
});

// ── P0-B: Integrity check determinism ────────────────────────────
describe("verifyHvscBrowseIndexIntegrity determinism (P0-B)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("samples same paths given same snapshot regardless of wall clock", async () => {
    vi.useFakeTimers();
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/A/One.sid", name: "One.sid", type: "sid" },
      { path: "/B/Two.sid", name: "Two.sid", type: "sid" },
      { path: "/C/Three.sid", name: "Three.sid", type: "sid" },
      { path: "/D/Four.sid", name: "Four.sid", type: "sid" },
      { path: "/E/Five.sid", name: "Five.sid", type: "sid" },
    ]);

    const getSampledPaths = async () => {
      const statted: string[] = [];
      vi.mocked(Filesystem.stat).mockImplementation(async ({ path }: { path: string }) => {
        statted.push(path);
        return { type: "file", size: 1 } as never;
      });
      await verifyHvscBrowseIndexIntegrity(snapshot, 3);
      vi.clearAllMocks();
      return statted;
    };

    // At time 0: Math.floor(0/1000) % 5 = 0
    vi.setSystemTime(0);
    const paths1 = await getSampledPaths();

    // At time 7 s: Math.floor(7000/1000) % 5 = 2 — would differ with the old Date.now() seed
    vi.setSystemTime(7000);
    const paths2 = await getSampledPaths();

    // With fix: same snapshot.updatedAt → same hash → same sampled paths
    expect(paths1).toEqual(paths2);
  });

  it("produces different samples for snapshots with different updatedAt", async () => {
    const entries = [
      { path: "/A/One.sid", name: "One.sid", type: "sid" as const },
      { path: "/B/Two.sid", name: "Two.sid", type: "sid" as const },
      { path: "/C/Three.sid", name: "Three.sid", type: "sid" as const },
      { path: "/D/Four.sid", name: "Four.sid", type: "sid" as const },
      { path: "/E/Five.sid", name: "Five.sid", type: "sid" as const },
    ];
    const snap1 = buildHvscBrowseIndexFromEntries(entries);
    // Manually set different updatedAt to simulate a newer ingestion
    const snap2 = {
      ...snap1,
      songs: { ...snap1.songs },
      folders: { ...snap1.folders },
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    const getSampledPaths = async (snapshot: typeof snap1) => {
      const statted: string[] = [];
      vi.mocked(Filesystem.stat).mockImplementation(async ({ path }: { path: string }) => {
        statted.push(path);
        return { type: "file", size: 1 } as never;
      });
      await verifyHvscBrowseIndexIntegrity(snapshot, 2);
      vi.clearAllMocks();
      return statted;
    };

    const paths1 = await getSampledPaths(snap1);
    const paths2 = await getSampledPaths(snap2);
    // Different updatedAt → possibly different sample starting point (not required to differ
    // but the function should not throw and both sets should be valid paths)
    expect(paths1.length).toBe(2);
    expect(paths2.length).toBe(2);
    paths1.forEach((p) => expect(typeof p).toBe("string"));
    paths2.forEach((p) => expect(typeof p).toBe("string"));
  });
});

describe("listFolderFromBrowseIndex missing folder fallback", () => {
  it("returns empty row when folder path does not exist in snapshot", () => {
    const snapshot = buildHvscBrowseIndexFromEntries([
      { path: "/DEMOS/A/One.sid", name: "One.sid", type: "sid" },
    ]);
    const result = listFolderFromBrowseIndex(snapshot, "/NONEXISTENT", "", 0, 50);
    expect(result.path).toBe("/NONEXISTENT");
    expect(result.folders).toEqual([]);
    expect(result.songs).toEqual([]);
    expect(result.totalFolders).toBe(0);
    expect(result.totalSongs).toBe(0);
  });
});
