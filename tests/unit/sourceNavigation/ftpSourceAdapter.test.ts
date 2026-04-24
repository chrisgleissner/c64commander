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
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: vi.fn(() => 21),
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: vi.fn(async () => "secret"),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => true),
  getCachedPassword: vi.fn(() => "secret"),
}));

import { listFtpDirectory } from "@/lib/ftp/ftpClient";
import { createUltimateSourceLocation, normalizeFtpHost } from "@/lib/sourceNavigation/ftpSourceAdapter";

const listFtpDirectoryMock = vi.mocked(listFtpDirectory);
import { CURRENT_DEVICE_HOST_KEY as DEVICE_HOST_KEY } from "@/lib/c64api/hostConfig";
const HAS_PASSWORD_KEY = "c64u_has_password";
const FTP_CACHE_KEY = "c64u_ftp_cache:v1";

describe("ftpSourceAdapter", () => {
  beforeEach(() => {
    listFtpDirectoryMock.mockReset();
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
