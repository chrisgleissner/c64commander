/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import {
  ingestLocalArchives,
  isSupportedLocalArchive,
} from "@/lib/sources/localArchiveIngestion";
import type { LocalSidFile } from "@/lib/sources/LocalFsSongSource";

// We use globalThis to share state between the vi.mock factory (hoisted before imports)
// and the test cases (run after module setup). The factory captures the real unzipSync
// and stores it on globalThis.
vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  (globalThis as any).__fflateReal = actual.unzipSync;
  return {
    ...actual,
    unzipSync: (...args: any[]) => {
      const override = (globalThis as any).__fflateOverrideOnce;
      if (override) {
        (globalThis as any).__fflateOverrideOnce = null;
        return override(...args);
      }
      return (globalThis as any).__fflateReal(...args);
    },
  };
});

vi.mock("7z-wasm", () => {
  const moduleFactory = () => {
    const FS = {
      mkdir: vi.fn(),
      rmdir: vi.fn(),
      open: vi.fn(() => ({ fd: 1 })),
      write: vi.fn(),
      close: vi.fn(),
      unlink: vi.fn(),
      readdir: (dir: string) => {
        if (dir.endsWith("/out")) return [".", "..", "music"];
        if (dir.endsWith("/out/music"))
          return [".", "..", "track.sid", "ignore.txt"];
        return [".", ".."];
      },
      stat: (path: string) => ({
        mode:
          path.endsWith("/out") || path.endsWith("/out/music") ? "dir" : "file",
      }),
      isDir: (mode: string) => mode === "dir",
      readFile: (path: string) => {
        if (path.endsWith("track.sid")) {
          return new Uint8Array(Buffer.from("SIDDATA"));
        }
        return new Uint8Array();
      },
    };

    (globalThis as any).__sevenZipFs = FS;

    return { FS, callMain: vi.fn() };
  };

  return { default: moduleFactory };
});

describe("localArchiveIngestion", () => {
  it("detects supported archive extensions", () => {
    expect(isSupportedLocalArchive("collection.zip")).toBe(true);
    expect(isSupportedLocalArchive("collection.7z")).toBe(true);
    expect(isSupportedLocalArchive("track.sid")).toBe(false);
  });

  it("extracts SID files from zip archives", async () => {
    const archiveData = zipSync({
      "C64Music/track.sid": new Uint8Array(Buffer.from("SIDDATA")),
      "C64Music/ignore.txt": new Uint8Array(Buffer.from("IGNORE")),
    });
    const archiveFile: LocalSidFile = {
      name: "collection.zip",
      lastModified: Date.now(),
      arrayBuffer: async () =>
        archiveData.buffer.slice(
          archiveData.byteOffset,
          archiveData.byteOffset + archiveData.byteLength,
        ),
    };
    const result = await ingestLocalArchives([archiveFile]);
    expect(result.archiveCount).toBe(1);
    expect(result.extractedCount).toBe(1);
    expect(result.files).toHaveLength(1);
    const entry = result.files[0];
    expect(entry.name).toBe("track.sid");
    expect(entry.webkitRelativePath).toContain("collection.zip");
    const buffer = await entry.arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe("SIDDATA");
  });

  it("handles Blob archives when arrayBuffer is not directly callable", async () => {
    const blobArchive = Object.assign(
      new Blob([new Uint8Array([1, 2, 3, 4])]),
      {
        arrayBuffer: undefined,
        name: "blob.zip",
        lastModified: Date.now(),
      },
    ) as unknown as LocalSidFile;

    await expect(ingestLocalArchives([blobArchive])).rejects.toThrow(
      "Failed to extract blob.zip: invalid zip data",
    );
  });

  it("surfaces unsupported archive objects that are not Blob and lack arrayBuffer", async () => {
    const invalidArchive = {
      name: "invalid.zip",
      lastModified: Date.now(),
    } as unknown as LocalSidFile;

    await expect(ingestLocalArchives([invalidArchive])).rejects.toThrow(
      "Failed to extract invalid.zip: Selected file does not support arrayBuffer.",
    );
  });

  it("keeps direct SID files and ignores unsupported files", async () => {
    const sidFile: LocalSidFile = {
      name: "track.sid",
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array(Buffer.from("SID")).buffer,
    };
    const otherFile: LocalSidFile = {
      name: "readme.txt",
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array(Buffer.from("TXT")).buffer,
    };

    const result = await ingestLocalArchives([sidFile, otherFile]);
    expect(result.archiveCount).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("track.sid");
  });

  it("extracts SID files from 7z archives using wasm module", async () => {
    const archiveFile: LocalSidFile = {
      name: "collection.7z",
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array(Buffer.from("SEVENZ")).buffer,
    };

    const result = await ingestLocalArchives([archiveFile]);
    expect(result.archiveCount).toBe(1);
    expect(result.extractedCount).toBe(1);
    expect(result.files[0].name).toBe("track.sid");
    const buffer = await result.files[0].arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe("SIDDATA");
  });

  it("wraps non-Error thrown by unzipSync using String() instead of .message (BRDA:69)", async () => {
    // Make unzipSync throw a non-Error string to cover the String(error) branch
    (globalThis as any).__fflateOverrideOnce = () => {
      throw "non-error-string-from-unzip";
    };

    const archiveFile: LocalSidFile = {
      name: "bad.zip",
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };

    await expect(ingestLocalArchives([archiveFile])).rejects.toThrow(
      "Failed to extract bad.zip: non-error-string-from-unzip",
    );
  });

  it("uses cached 7z WASM module on second extraction (no re-initialization)", async () => {
    // Covers the false branch of `if (!sevenZipModulePromise)` in getSevenZipModule.
    // The first 7z test initialises the module; this second call reuses the cached promise.
    const archiveFile: LocalSidFile = {
      name: "second.7z",
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array(Buffer.from("SEVENZ2")).buffer,
    };

    const result = await ingestLocalArchives([archiveFile]);
    expect(result.archiveCount).toBe(1);
    expect(result.extractedCount).toBe(1);
  });

  it("continues extraction when 7z cleanup operations fail", async () => {
    const fs = (globalThis as any).__sevenZipFs;
    const originalRmdir = fs.rmdir;
    const originalUnlink = fs.unlink;

    try {
      let rmdirCount = 0;
      fs.rmdir = vi.fn((path: string) => {
        rmdirCount += 1;
        if (rmdirCount <= 2) {
          throw new Error(`rmdir-failed:${path}`);
        }
        return originalRmdir(path);
      });
      fs.unlink = vi.fn((path: string) => {
        if (String(path).includes("/work-")) {
          throw new Error(`unlink-failed:${path}`);
        }
        return originalUnlink(path);
      });

      const archiveFile: LocalSidFile = {
        name: "cleanup.7z",
        lastModified: Date.now(),
        arrayBuffer: async () => new Uint8Array(Buffer.from("SEVENZ")).buffer,
      };

      const result = await ingestLocalArchives([archiveFile]);
      expect(result.extractedCount).toBe(1);
    } finally {
      fs.rmdir = originalRmdir;
      fs.unlink = originalUnlink;
    }
  });

  it("wraps Error thrown during 7z extraction with archive context", async () => {
    const fs = (globalThis as any).__sevenZipFs;
    const originalOpen = fs.open;

    try {
      fs.open = vi.fn(() => {
        throw new Error("open failed");
      });

      const archiveFile: LocalSidFile = {
        name: "error.7z",
        lastModified: Date.now(),
        arrayBuffer: async () => new Uint8Array(Buffer.from("SEVENZ")).buffer,
      };

      await expect(ingestLocalArchives([archiveFile])).rejects.toThrow(
        "Failed to extract error.7z: open failed",
      );
    } finally {
      fs.open = originalOpen;
    }
  });
});
