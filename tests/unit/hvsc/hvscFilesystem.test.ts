/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Filesystem, type FilesystemStatResult } from "@capacitor/filesystem";
import {
  deleteLibraryFile,
  getHvscDurationByMd5,
  getHvscSongByVirtualPath,
  readCachedArchiveMarker,
  listHvscFolder,
  MAX_BRIDGE_READ_BYTES,
  resetLibraryRoot,
  resetSonglengthsCache,
  resolveLibraryPath,
  writeCachedArchiveMarker,
  writeCachedArchive,
  writeLibraryFile,
  createLibraryStagingDir,
  writeStagingFile,
  resolveStagingPath,
  promoteLibraryStagingDir,
  cleanupStaleStagingDir,
} from "@/lib/hvsc/hvscFilesystem";
import * as logging from "@/lib/logging";

type Entry = { type: "file" | "directory"; data?: string };

const files = new Map<string, Entry>();

const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/^\//, "");

const ensureDir = (path: string) => {
  const parts = normalizePath(path).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!files.has(current)) {
      files.set(current, { type: "directory" });
    }
  }
};

const setFile = (path: string, data: string) => {
  const normalized = normalizePath(path);
  const parent = normalized.split("/").slice(0, -1).join("/");
  if (parent) ensureDir(parent);
  files.set(normalized, { type: "file", data });
};

const listDir = (path: string) => {
  const normalized = normalizePath(path);
  const prefix = normalized ? `${normalized}/` : "";
  const entries = new Map<string, Entry>();
  for (const [key, entry] of files) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const next = rest.split("/")[0];
    if (!next) continue;
    const entryPath = normalized ? `${normalized}/${next}` : next;
    entries.set(next, files.get(entryPath) ?? { type: "directory" });
  }
  return Array.from(entries.entries()).map(([name, entry]) => ({
    name,
    type: entry.type,
  }));
};

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    mkdir: vi.fn(async ({ path }: { path: string }) => {
      ensureDir(path);
    }),
    readdir: vi.fn(async ({ path }: { path: string }) => ({
      files: listDir(path),
    })),
    stat: vi.fn(async ({ path }: { path: string }): Promise<FilesystemStatResult> => {
      const normalized = normalizePath(path);
      const entry = files.get(normalized);
      if (!entry) {
        throw new Error(`Missing path: ${normalized}`);
      }
      return {
        type: entry.type,
        size: entry.data?.length ?? 0,
      } as FilesystemStatResult;
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      const normalized = normalizePath(path);
      const entry = files.get(normalized);
      if (!entry || entry.type !== "file") {
        throw new Error(`Missing file: ${normalized}`);
      }
      return { data: entry.data ?? "" };
    }),
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      setFile(path, data);
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      files.delete(normalizePath(path));
    }),
    rmdir: vi.fn(async ({ path }: { path: string }) => {
      const normalized = normalizePath(path);
      for (const key of Array.from(files.keys())) {
        if (key === normalized || key.startsWith(`${normalized}/`)) {
          files.delete(key);
        }
      }
    }),
    rename: vi.fn(async ({ from, to }: { from: string; to: string }) => {
      const normalizedFrom = normalizePath(from);
      const normalizedTo = normalizePath(to);
      const fromEntry = files.get(normalizedFrom);
      if (!fromEntry) {
        throw new Error(`Rename source not found: ${normalizedFrom}`);
      }
      // Move all entries under the source prefix to the destination
      const toMove: [string, Entry][] = [];
      for (const [key, entry] of files) {
        if (key === normalizedFrom || key.startsWith(`${normalizedFrom}/`)) {
          const newKey = normalizedTo + key.slice(normalizedFrom.length);
          toMove.push([key, { ...entry }]);
          files.delete(key);
          files.set(newKey, entry);
        }
      }
    }),
  },
}));

const toBase64 = (value: string) => btoa(value);
const toBase64Bytes = (data: Uint8Array) => btoa(String.fromCharCode(...data));

const writeSonglengthsTxt = () => {
  setFile("hvsc/library/Songlengths.txt", toBase64("DEMOS/0-9/Test.sid 0:30"));
};

const writeSonglengthsMd5 = (md5: string) => {
  const content = `; /DEMOS/0-9/Test.sid\n${md5}=0:45`;
  setFile("hvsc/library/Songlengths.md5", toBase64(content));
};

describe("hvscFilesystem", () => {
  beforeEach(() => {
    files.clear();
    resetSonglengthsCache();
  });

  it("lists folders and songs with durations", async () => {
    ensureDir("hvsc/library/DEMOS/0-9");
    setFile("hvsc/library/DEMOS/0-9/Test.sid", toBase64Bytes(new Uint8Array([1, 2, 3])));
    writeSonglengthsTxt();

    const listing = await listHvscFolder("/DEMOS/0-9");
    expect(listing.path).toBe("/DEMOS/0-9");
    expect(listing.folders).toEqual([]);
    expect(listing.songs).toHaveLength(1);
    expect(listing.songs[0].fileName).toBe("Test.sid");
    expect(listing.songs[0].durationSeconds).toBe(30);
  });

  it("returns song data by virtual path and uses md5 duration", async () => {
    const md5 = "abcdef1234567890";
    ensureDir("hvsc/library/DEMOS/0-9");
    setFile("hvsc/library/DEMOS/0-9/Test.sid", toBase64Bytes(new Uint8Array([4, 5, 6])));
    writeSonglengthsMd5(md5);

    const song = await getHvscSongByVirtualPath("/DEMOS/0-9/Test.sid");
    expect(song?.fileName).toBe("Test.sid");
    expect(song?.dataBase64).toBeTruthy();

    const duration = await getHvscDurationByMd5(md5);
    expect(duration).toBe(45);
  });

  it("writes and deletes library files", async () => {
    await writeLibraryFile("/DEMOS/0-9/Write.sid", new Uint8Array([7, 8]));
    const stored = files.get("hvsc/library/DEMOS/0-9/Write.sid");
    expect(stored?.type).toBe("file");

    await deleteLibraryFile("/DEMOS/0-9/Write.sid");
    expect(files.has("hvsc/library/DEMOS/0-9/Write.sid")).toBe(false);
  });

  it("resets the library root", async () => {
    ensureDir("hvsc/library/DEMOS/0-9");
    setFile("hvsc/library/DEMOS/0-9/Test.sid", toBase64Bytes(new Uint8Array([9])));

    await resetLibraryRoot();

    expect(listDir("hvsc/library")).toEqual([]);
  });

  it("writes cached archives to the cache directory", async () => {
    await writeCachedArchive("hvsc-update-84.7z", new Uint8Array([1, 2]));
    const cached = files.get("hvsc/cache/hvsc-update-84.7z");
    expect(cached?.type).toBe("file");
  });

  it("writes and reads cached archive markers", async () => {
    await writeCachedArchiveMarker("hvsc-baseline-85.7z", {
      version: 85,
      type: "baseline",
      sizeBytes: 1024,
      expectedSizeBytes: 2048,
      checksumMd5: "abc123",
      sourceUrl: "https://example.com/hvsc-baseline-85.7z",
      completedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    });

    const marker = await readCachedArchiveMarker("hvsc-baseline-85.7z");
    expect(marker?.version).toBe(85);
    expect(marker?.type).toBe("baseline");
    expect(marker?.sizeBytes).toBe(1024);
    expect(marker?.expectedSizeBytes).toBe(2048);
    expect(marker?.checksumMd5).toBe("abc123");
    expect(marker?.sourceUrl).toBe("https://example.com/hvsc-baseline-85.7z");
  });

  it("omits non-sid files from folder listings", async () => {
    ensureDir("hvsc/library/DEMOS/0-9");
    setFile("hvsc/library/DEMOS/0-9/Readme.txt", toBase64("hello"));

    const listing = await listHvscFolder("/DEMOS/0-9");

    expect(listing.songs).toHaveLength(0);
  });

  it("returns null when song is missing", async () => {
    const warnSpy = vi.spyOn(logging, "addLog");
    const song = await getHvscSongByVirtualPath("/missing.sid");
    expect(song).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "debug",
      "HVSC filesystem: Failed to read HVSC song by path",
      expect.objectContaining({
        virtualPath: "/missing.sid",
      }),
    );
    warnSpy.mockRestore();
  });

  it("short-circuits writes when file already exists", async () => {
    setFile("hvsc/library/DEMOS/0-9/Existing.sid", toBase64Bytes(new Uint8Array([1])));
    vi.mocked(Filesystem.writeFile).mockImplementationOnce(async () => {
      throw new Error("already exists");
    });

    await expect(writeLibraryFile("/DEMOS/0-9/Existing.sid", new Uint8Array([2]))).resolves.toBeUndefined();

    const stored = files.get("hvsc/library/DEMOS/0-9/Existing.sid");
    expect(stored?.type).toBe("file");
  });

  it("getErrorMessage extracts string error (line 55)", async () => {
    // Throw a raw string error so getErrorMessage takes the typeof=string branch
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce("already exists");
    await expect(writeLibraryFile("/ERR/line55.sid", new Uint8Array([1]))).resolves.toBeUndefined();
  });

  it("getErrorMessage extracts .error string property (line 58)", async () => {
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce({
      error: "already exists",
    });
    await expect(writeLibraryFile("/ERR/line58.sid", new Uint8Array([1]))).resolves.toBeUndefined();
  });

  it("getErrorMessage falls back to String() for unrecognised error shapes (line 65)", async () => {
    // Throw a number; isExistsError returns false so writeLibraryFile re-throws
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(42);
    await expect(writeLibraryFile("/ERR/line65.sid", new Uint8Array([1]))).rejects.toBeDefined();
  });

  it("readFileWithSizeGuard throws for files exceeding MAX_BRIDGE_READ_BYTES (line 99)", async () => {
    ensureDir("hvsc/library/LARGE");
    setFile("hvsc/library/LARGE/Big.sid", toBase64Bytes(new Uint8Array([1])));
    // Override stat to report an oversized file
    vi.mocked(Filesystem.stat).mockResolvedValueOnce({
      type: "file",
      size: MAX_BRIDGE_READ_BYTES + 1,
    } as FilesystemStatResult);
    await expect(getHvscSongByVirtualPath("/LARGE/Big.sid")).resolves.toBeNull();
  });

  it("writeFileWithRetry short-circuits on second exists error when file present (line 138)", async () => {
    // First write: exists error; stat: not found; second write: exists error; stat: file found
    vi.mocked(Filesystem.writeFile)
      .mockRejectedValueOnce(new Error("already exists"))
      .mockRejectedValueOnce(new Error("already exists"));
    vi.mocked(Filesystem.stat)
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({ type: "file", size: 5 } as FilesystemStatResult);
    await expect(writeLibraryFile("/RETRY/Test.sid", new Uint8Array([1]))).resolves.toBeUndefined();
  });

  it("resolveLibraryPath returns base dir for root virtual path (line 187)", () => {
    expect(resolveLibraryPath("/")).toBe("hvsc/library");
  });

  it("listHvscFolder returns empty listing for root path (line 191)", async () => {
    const listing = await listHvscFolder("/");
    expect(listing.path).toBe("/");
    expect(listing.folders).toEqual([]);
    expect(listing.songs).toEqual([]);
  });

  it("listEntries returns empty array when readdir result has no files key (line 199)", async () => {
    ensureDir("hvsc/library/NFILES");
    vi.mocked(Filesystem.readdir).mockResolvedValueOnce({} as any);
    const listing = await listHvscFolder("/NFILES");
    expect(listing.songs).toEqual([]);
    expect(listing.folders).toEqual([]);
  });

  it("getHvscSongByVirtualPath returns null duration when no songlength exists (lines 276, 284)", async () => {
    ensureDir("hvsc/library/NODUR");
    setFile("hvsc/library/NODUR/NoLen.sid", toBase64Bytes(new Uint8Array([1, 2])));
    // No songlengths files → duration strategy is not-found, durations/durationSeconds are null
    const song = await getHvscSongByVirtualPath("/NODUR/NoLen.sid");
    expect(song?.fileName).toBe("NoLen.sid");
    expect(song?.durationSeconds).toBeNull();
    expect(song?.subsongCount).toBeNull();
  });

  describe("staging", () => {
    it("createLibraryStagingDir creates staging directory and removes stale one", async () => {
      setFile("hvsc/library-staging/stale.sid", toBase64Bytes(new Uint8Array([1])));

      await createLibraryStagingDir();

      expect(files.has("hvsc/library-staging/stale.sid")).toBe(false);
      expect(files.has("hvsc/library-staging")).toBe(true);
    });

    it("resolveStagingPath maps virtual paths to staging directory", () => {
      expect(resolveStagingPath("/DEMOS/0-9/Test.sid")).toBe(
        "hvsc/library-staging/DEMOS/0-9/Test.sid",
      );
      expect(resolveStagingPath("/")).toBe("hvsc/library-staging");
    });

    it("writeStagingFile writes to the staging directory", async () => {
      await createLibraryStagingDir();
      await writeStagingFile("/DEMOS/0-9/Test.sid", new Uint8Array([7, 8]));

      const stored = files.get("hvsc/library-staging/DEMOS/0-9/Test.sid");
      expect(stored?.type).toBe("file");
    });

    it("promoteLibraryStagingDir swaps staging to library atomically", async () => {
      // Set up existing library with old content
      setFile("hvsc/library/OLD/Old.sid", toBase64Bytes(new Uint8Array([1])));

      // Set up staging with new content
      ensureDir("hvsc/library-staging");
      setFile(
        "hvsc/library-staging/NEW/New.sid",
        toBase64Bytes(new Uint8Array([2])),
      );

      await promoteLibraryStagingDir();

      // Old library content should be gone
      expect(files.has("hvsc/library/OLD/Old.sid")).toBe(false);
      // New content should be under library now
      expect(files.has("hvsc/library/NEW/New.sid")).toBe(true);
      // Staging and old dirs should be cleaned up
      expect(files.has("hvsc/library-staging")).toBe(false);
      expect(files.has("hvsc/library-old")).toBe(false);
    });

    it("promoteLibraryStagingDir works on first install with no existing library", async () => {
      // No existing library — only staging exists
      ensureDir("hvsc/library-staging");
      setFile(
        "hvsc/library-staging/FIRST/Song.sid",
        toBase64Bytes(new Uint8Array([3])),
      );

      await promoteLibraryStagingDir();

      expect(files.has("hvsc/library/FIRST/Song.sid")).toBe(true);
      expect(files.has("hvsc/library-staging")).toBe(false);
    });

    it("cleanupStaleStagingDir removes both staging and old directories", async () => {
      ensureDir("hvsc/library-staging/leftover");
      setFile(
        "hvsc/library-staging/leftover/stale.sid",
        toBase64Bytes(new Uint8Array([1])),
      );
      ensureDir("hvsc/library-old/leftover");
      setFile(
        "hvsc/library-old/leftover/stale.sid",
        toBase64Bytes(new Uint8Array([2])),
      );

      await cleanupStaleStagingDir();

      expect(files.has("hvsc/library-staging")).toBe(false);
      expect(files.has("hvsc/library-old")).toBe(false);
    });

    it("cleanupStaleStagingDir is safe when no staging dirs exist", async () => {
      // Should not throw even when neither directory exists
      await expect(cleanupStaleStagingDir()).resolves.toBeUndefined();
    });
  });
});
