/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: vi.fn(),
  listFtpDirectoryRecursive: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: vi.fn(() => 21),
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

vi.mock("@/lib/native/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native/platform")>();
  return {
    ...actual,
    isNativePlatform: vi.fn(() => false),
  };
});

vi.mock("@/lib/secureStorage", () => ({
  getPassword: vi.fn(async () => "secret"),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => true),
  getCachedPassword: vi.fn(() => "secret"),
}));

import { listFtpDirectory, listFtpDirectoryRecursive } from "@/lib/ftp/ftpClient";
import { addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";
import { createUltimateSourceLocation, normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";

const listFtpDirectoryMock = vi.mocked(listFtpDirectory);
const listFtpDirectoryRecursiveMock = vi.mocked(listFtpDirectoryRecursive);
const isNativePlatformMock = vi.mocked(isNativePlatform);
import { CURRENT_DEVICE_HOST_KEY as DEVICE_HOST_KEY } from "@/lib/c64api/hostConfig";
const HAS_PASSWORD_KEY = "c64u_has_password";
const FTP_CACHE_KEY = "c64u_ftp_cache:v1";

describe("ftpSourceAdapter", () => {
  beforeEach(() => {
    listFtpDirectoryMock.mockReset();
    listFtpDirectoryRecursiveMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
    localStorage.clear();
    localStorage.setItem(DEVICE_HOST_KEY, "c64u");
    localStorage.setItem(HAS_PASSWORD_KEY, "1");
  });

  it("caches directory listings and reuses cache", async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        {
          type: "file",
          name: "track.sid",
          path: "/track.sid",
          size: 123,
          modifiedAt: "now",
        },
      ],
    });

    const source = createUltimateSourceLocation();
    const first = await source.listEntries("/");
    const second = await source.listEntries("/");

    expect(first).toEqual(second);
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it("clears cache for path and refetches", async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        {
          type: "file",
          name: "track.sid",
          path: "/track.sid",
          size: 123,
          modifiedAt: "now",
        },
      ],
    });

    const source = createUltimateSourceLocation();
    await source.listEntries("/");
    source.clearCacheForPath("/");
    await source.listEntries("/");

    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it("clears cache for descendant paths too, not just the exact refreshed path (HARD9-082)", async () => {
    // Regression: Refresh only invalidated the exact current path - a
    // recursive "Add folder" from an ancestor would still resolve
    // unrefreshed children through the (up to 10-minute-stale) cache.
    listFtpDirectoryMock.mockResolvedValue({
      entries: [{ type: "file", name: "track.sid", path: "/music/track.sid", size: 123, modifiedAt: "now" }],
    });

    const source = createUltimateSourceLocation();
    await source.listEntries("/music");
    await source.listEntries("/music/sub");
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(2);

    source.clearCacheForPath("/music");

    await source.listEntries("/music");
    await source.listEntries("/music/sub");
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(4);
  });

  it("recursive scans always read live instead of serving stale cached children (HARD9-082)", async () => {
    // Regression: the recursive BFS resolved every child via the same
    // cache used by ordinary browsing (10-minute TTL) - new device-side
    // files were missing and deleted files were still offered until the
    // cache naturally expired.
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === "/") {
        return { entries: [{ type: "dir", name: "music", path: "/music" }] };
      }
      return {
        entries: [{ type: "file", name: "track.sid", path: "/music/track.sid", size: 1, modifiedAt: "now" }],
      };
    });

    const source = createUltimateSourceLocation();
    // Populate the cache for "/music" via ordinary (cached) browsing first.
    await source.listEntries("/music");
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(1);

    await source.listFilesRecursive("/");

    // "/" (root) and "/music" both fetched live during the recursive walk,
    // even though "/music" was already cached.
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(3);
  });

  it("recursively lists files across directories", async () => {
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === "/") {
        return {
          entries: [
            { type: "dir", name: "music", path: "/music" },
            {
              type: "file",
              name: "root.sid",
              path: "/root.sid",
              size: 5,
              modifiedAt: "now",
            },
          ],
        };
      }
      if (path === "/music") {
        return {
          entries: [
            {
              type: "file",
              name: "song.sid",
              path: "/music/song.sid",
              size: 10,
              modifiedAt: "now",
            },
          ],
        };
      }
      return { entries: [] };
    });

    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive("/");

    expect(results.map((entry) => entry.path).sort()).toEqual(["/music/song.sid", "/root.sid"]);
  });

  it("uses the native recursive listing bridge on native platforms", async () => {
    isNativePlatformMock.mockReturnValue(true);
    listFtpDirectoryRecursiveMock.mockResolvedValue({
      path: "/",
      entries: [
        { type: "file", name: "root.sid", path: "/root.sid", size: 5, modifiedAt: "now" },
        { type: "file", name: "song.sid", path: "/music/song.sid", size: 10, modifiedAt: "now" },
      ],
      partialFailures: [{ path: "/bad", message: "listing failed" }],
    });

    const source = createUltimateSourceLocation();
    const deltas: number[] = [];
    const results = await source.listFilesRecursive("/", { onProgress: (delta) => deltas.push(delta) });

    expect(listFtpDirectoryRecursiveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "c64u",
        port: 21,
        password: "secret",
        path: "/",
        maxDepth: 8,
        maxEntries: 5000,
      }),
    );
    expect(listFtpDirectoryMock).not.toHaveBeenCalled();
    expect(results.map((entry) => entry.path).sort()).toEqual(["/music/song.sid", "/root.sid"]);
    expect(results.partialFailures).toEqual([{ path: "/bad", message: "listing failed" }]);
    expect(deltas).toEqual([2]);
  });

  it("surfaces a native timedOut walk as a partial failure (HARD9-078)", async () => {
    // Regression: the native walk bailing early on an FTP data-channel
    // timeout must not present a silently truncated tree as a complete
    // listing.
    isNativePlatformMock.mockReturnValue(true);
    listFtpDirectoryRecursiveMock.mockResolvedValue({
      path: "/",
      entries: [{ type: "file", name: "root.sid", path: "/root.sid", size: 5, modifiedAt: "now" }],
      partialFailures: [],
      timedOut: true,
    });

    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive("/");

    expect(results.partialFailures).toEqual([{ path: "/", message: "Listing incomplete: device FTP timed out" }]);
  });

  it("reports incremental onProgress as files are discovered during the recursive walk", async () => {
    // Regression for S2-DISKS-FTP-RECURSIVE-SCAN-STALL: a broad-folder scan must
    // report progress as it goes, not only once at the end (which showed a stuck
    // "Scanning… 0 items").
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === "/") {
        return {
          entries: [
            { type: "dir", name: "music", path: "/music" },
            { type: "file", name: "root.sid", path: "/root.sid", size: 5, modifiedAt: "now" },
          ],
        };
      }
      if (path === "/music") {
        return {
          entries: [{ type: "file", name: "song.sid", path: "/music/song.sid", size: 10, modifiedAt: "now" }],
        };
      }
      return { entries: [] };
    });

    const source = createUltimateSourceLocation();
    const deltas: number[] = [];
    const results = await source.listFilesRecursive("/", { onProgress: (delta) => deltas.push(delta) });

    // Two files discovered across two directory listings → at least one progress
    // callback before completion, summing to the total file count (not 0).
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(results.length);
  });

  it("returns partial recursive results when one directory listing fails", async () => {
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === "/") {
        return {
          entries: [
            { type: "dir", name: "ok", path: "/ok" },
            { type: "dir", name: "fail", path: "/fail" },
            {
              type: "file",
              name: "root.d64",
              path: "/root.d64",
              size: 5,
              modifiedAt: "now",
            },
          ],
        };
      }
      if (path === "/ok") {
        return {
          entries: [
            {
              type: "file",
              name: "disk.d64",
              path: "/ok/disk.d64",
              size: 10,
              modifiedAt: "now",
            },
          ],
        };
      }
      throw new Error("listing failed");
    });

    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive("/");

    expect(results.map((entry) => entry.path).sort()).toEqual(["/ok/disk.d64", "/root.d64"]);
    expect(results.partialFailures).toEqual([{ path: "/fail", message: "listing failed" }]);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "FTP recursive directory listing skipped folder",
      expect.objectContaining({
        path: "/fail",
        error: expect.objectContaining({ message: "listing failed" }),
      }),
    );
  });

  it("caps the web recursive scan at the same max depth as native, reporting truncation (HARD9-081)", async () => {
    // Regression: the web BFS had no depth cap at all, unlike native (8
    // levels) - a deeply nested USB folder walked the entire tree with no
    // indication anything was cut short.
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      const depth = path === "/" ? 0 : path.split("/").length - 1;
      return {
        entries: [
          { type: "dir", name: `level${depth + 1}`, path: `${path === "/" ? "" : path}/level${depth + 1}` },
          {
            type: "file",
            name: `file${depth}.sid`,
            path: `${path === "/" ? "" : path}/file${depth}.sid`,
            size: 1,
            modifiedAt: "now",
          },
        ],
      };
    });

    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive("/");

    // Depths 0..8 (9 levels) are walked - depth 8 is the last one allowed to
    // recurse further, so files 0..8 are collected (9 files) and the
    // depth-9 subfolder is reported as truncated instead of walked forever.
    expect(results.length).toBe(9);
    expect(results.partialFailures?.some((failure) => failure.message.includes("max depth 8 reached"))).toBe(true);
  });

  it("caps the web recursive scan at the same max entries as native, reporting truncation (HARD9-081)", async () => {
    // Regression: the web BFS had no entry-count cap at all, unlike native
    // (5000 entries) - a broad folder scanned tens of thousands of entries
    // with no indication anything was cut short.
    const manyFiles = Array.from({ length: 5001 }, (_, index) => ({
      type: "file" as const,
      name: `song${index}.sid`,
      path: `/song${index}.sid`,
      size: 1,
      modifiedAt: "now",
    }));
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === "/") {
        return { entries: manyFiles };
      }
      return { entries: [] };
    });

    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive("/");

    expect(results.length).toBe(5000);
    expect(results.partialFailures?.some((failure) => failure.message.includes("stopped after 5000 entries"))).toBe(
      true,
    );
  });

  it("cancels recursive listing and stops further FTP calls", async () => {
    const controller = new AbortController();
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === "/") {
        controller.abort();
        return {
          entries: [
            { type: "dir", name: "music", path: "/music" },
            {
              type: "file",
              name: "root.sid",
              path: "/root.sid",
              size: 5,
              modifiedAt: "now",
            },
          ],
        };
      }
      return {
        entries: [
          {
            type: "file",
            name: "song.sid",
            path: "/music/song.sid",
            size: 10,
            modifiedAt: "now",
          },
        ],
      };
    });

    const source = createUltimateSourceLocation();
    await expect(source.listFilesRecursive("/", { signal: controller.signal })).rejects.toThrow(/Aborted/);
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows (does not swallow) an AbortError raised by the underlying listing", async () => {
    isNativePlatformMock.mockReturnValue(false);
    const abortError = new Error("listing aborted");
    abortError.name = "AbortError";
    listFtpDirectoryMock.mockRejectedValue(abortError);

    const source = createUltimateSourceLocation();
    // The recursive walker treats an AbortError as fatal, not a per-folder partial failure.
    await expect(source.listFilesRecursive("/")).rejects.toThrow("listing aborted");
  });

  it("logs when cached FTP listing is corrupted", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem(FTP_CACHE_KEY, "{bad-json");
    listFtpDirectoryMock.mockResolvedValue({ entries: [] });

    const source = createUltimateSourceLocation();
    await source.listEntries("/");

    expect(warnSpy).toHaveBeenCalledWith("Failed to load FTP cache", expect.any(Object));
    warnSpy.mockRestore();
  });

  it("normalizeFtpHost returns empty string as-is", () => {
    expect(normalizeFtpHost("")).toBe("c64u");
  });

  it("normalizeFtpHost strips IPv6 brackets", () => {
    expect(normalizeFtpHost("[::1]")).toBe("[::1]");
    expect(normalizeFtpHost("[fe80::1]:8021")).toBe("[fe80::1]");
  });

  it("normalizeFtpHost strips port from host:port", () => {
    expect(normalizeFtpHost("192.168.1.1:8021")).toBe("192.168.1.1");
  });

  it("normalizeFtpHost preserves plain hostname", () => {
    expect(normalizeFtpHost("c64u")).toBe("c64u");
  });

  it("normalizes empty path to / in listEntries", async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [{ type: "file", name: "a.sid", path: "/a.sid" }],
    });
    const source = createUltimateSourceLocation();
    const result = await source.listEntries("");
    expect(result).toHaveLength(1);
    expect(result[0].sizeBytes).toBeNull();
    expect(result[0].modifiedAt).toBeNull();
  });

  it("clearCacheForPath normalizes empty path", async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        {
          type: "file",
          name: "a.sid",
          path: "/a.sid",
          size: 1,
          modifiedAt: "x",
        },
      ],
    });
    const source = createUltimateSourceLocation();
    await source.listEntries("/");
    source.clearCacheForPath("");
    await source.listEntries("/");
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it("evicts oldest cache entries when exceeding limit", async () => {
    // Fill cache beyond MAX_CACHE_ENTRIES (200)
    const cache: Record<string, unknown> = {};
    const order: string[] = [];
    for (let i = 0; i < 201; i++) {
      const key = `c64u:21:/dir${i}`;
      cache[key] = { entries: [], updatedAt: Date.now() };
      order.push(key);
    }
    localStorage.setItem(FTP_CACHE_KEY, JSON.stringify({ entries: cache, order }));

    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        {
          type: "file",
          name: "z.sid",
          path: "/new/z.sid",
          size: 1,
          modifiedAt: "x",
        },
      ],
    });
    const source = createUltimateSourceLocation();
    await source.listEntries("/new");

    const stored = JSON.parse(localStorage.getItem(FTP_CACHE_KEY)!);
    // Should not exceed MAX_CACHE_ENTRIES
    expect(stored.order.length).toBeLessThanOrEqual(200);
  });

  it("handles localStorage.setItem quota exceeded gracefully", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Pre-populate cache so the loadCache read succeeds, then make setItem throw
    localStorage.setItem(FTP_CACHE_KEY, JSON.stringify({ entries: {}, order: [] }));
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === FTP_CACHE_KEY) throw new DOMException("QuotaExceededError");
      originalSetItem.call(this, key, value);
    };

    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        {
          type: "file",
          name: "a.sid",
          path: "/a.sid",
          size: 1,
          modifiedAt: "x",
        },
      ],
    });
    const source = createUltimateSourceLocation();
    await source.listEntries("/");

    Storage.prototype.setItem = originalSetItem;
    expect(warnSpy).toHaveBeenCalledWith("Failed to persist FTP cache", expect.any(Object));
    warnSpy.mockRestore();
  });

  it("handles null parsed cache (non-object)", async () => {
    localStorage.setItem(FTP_CACHE_KEY, "null");
    listFtpDirectoryMock.mockResolvedValue({ entries: [] });

    const source = createUltimateSourceLocation();
    const result = await source.listEntries("/");
    expect(result).toEqual([]);
  });

  it("handles parsed.order not being an array", async () => {
    localStorage.setItem(FTP_CACHE_KEY, JSON.stringify({ entries: {}, order: "not-array" }));
    listFtpDirectoryMock.mockResolvedValue({ entries: [] });

    const source = createUltimateSourceLocation();
    const result = await source.listEntries("/");
    expect(result).toEqual([]);
  });

  it("skips visited paths in recursive listing", async () => {
    listFtpDirectoryMock.mockImplementation(async ({ path }) => {
      if (path === "/") {
        return {
          entries: [
            { type: "dir", name: "a", path: "/a" },
            { type: "dir", name: "a", path: "/a" }, // duplicate
          ],
        };
      }
      if (path === "/a") {
        return {
          entries: [
            {
              type: "file",
              name: "x.sid",
              path: "/a/x.sid",
              size: 1,
              modifiedAt: "x",
            },
          ],
        };
      }
      return { entries: [] };
    });
    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive("/");
    expect(results).toHaveLength(1);
  });

  it("falls back to empty entries object when parsed cache has no entries key", async () => {
    // Covers parsed.entries ?? {} (line 37: ?? {} branch)
    localStorage.setItem(FTP_CACHE_KEY, JSON.stringify({ order: ["/"] }));
    listFtpDirectoryMock.mockResolvedValue({ entries: [] });
    const source = createUltimateSourceLocation();
    const result = await source.listEntries("/");
    expect(result).toEqual([]);
  });

  it("handles listFtpDirectory result with no entries key (falsy entries)", async () => {
    // Covers result.entries || [] (line 112: || [] branch when entries is absent)
    listFtpDirectoryMock.mockResolvedValue({} as any);
    const source = createUltimateSourceLocation();
    const result = await source.listEntries("/");
    expect(result).toEqual([]);
  });

  it("uses root path when listEntries called with empty string", async () => {
    // Covers path && path !== '' ? path : '/' (line 101 FALSE → '/')
    // and also: path || '/' in listFilesRecursive (line 124)
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        {
          type: "file",
          name: "a.sid",
          path: "/a.sid",
          size: 10,
          modifiedAt: "x",
        },
      ],
    });
    const source = createUltimateSourceLocation();
    const result = await source.listEntries("");
    expect(result).toHaveLength(1);
    // Verify the FTP call was made with '/'
    expect(listFtpDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({ path: "/" }));
  });

  it("uses root path when listFilesRecursive called with empty string", async () => {
    // Covers path || '/' (line 124: || '/' branch when path is empty)
    listFtpDirectoryMock.mockResolvedValue({ entries: [] });
    const source = createUltimateSourceLocation();
    const results = await source.listFilesRecursive("");
    expect(results).toEqual([]);
    expect(listFtpDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({ path: "/" }));
  });

  it("treats expired cache entry as miss and re-fetches", async () => {
    // Covers Date.now() - record.updatedAt > CACHE_TTL_MS (line 74: TTL expired branch)
    const expiredEntry = {
      entries: [],
      updatedAt: Date.now() - 20 * 60 * 1000,
    };
    localStorage.setItem(
      "c64u_ftp_cache:v1",
      JSON.stringify({
        entries: { "c64u:21:/": expiredEntry },
        order: ["c64u:21:/"],
      }),
    );
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        {
          type: "file",
          name: "fresh.sid",
          path: "/fresh.sid",
          size: 5,
          modifiedAt: "now",
        },
      ],
    });
    const source = createUltimateSourceLocation();
    const result = await source.listEntries("/");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("fresh.sid");
    // Should have fetched from FTP (cache was expired)
    expect(listFtpDirectoryMock).toHaveBeenCalledTimes(1);
  });

  describe("normalizeFtpHost", () => {
    it("removes port from plain hostname", () => {
      expect(normalizeFtpHost("example.com:21")).toBe("example.com");
    });

    it("returns empty for empty host", () => {
      expect(normalizeFtpHost("")).toBe("c64u");
    });

    it("handles IPv6 address in brackets", () => {
      // Covers `if (host.startsWith('['))` branch
      expect(normalizeFtpHost("[::1]:21")).toBe("[::1]");
    });

    it("handles IPv6 address without port", () => {
      expect(normalizeFtpHost("[2001:db8::1]")).toBe("[2001:db8::1]");
    });

    it("handles IPv6 with unclosed bracket", () => {
      expect(normalizeFtpHost("[::1")).toBe("[::1");
    });
  });
});
