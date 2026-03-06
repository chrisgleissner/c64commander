/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Capacitor Filesystem
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: {
    readFile: () => mockReadFile(),
    writeFile: (_args: unknown) => mockWriteFile(_args),
    mkdir: (_args: unknown) => mockMkdir(_args),
  },
  Directory: {
    Data: "Data",
  },
}));

describe("filesystemMediaIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("FilesystemMediaIndexStorage", () => {
    it("returns null when file does not exist", async () => {
      mockReadFile.mockRejectedValue(new Error("File not found"));

      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();

      expect(result).toBeNull();
    });

    it("reads and parses valid snapshot", async () => {
      const snapshot = {
        version: 1 as const,
        updatedAt: "2024-01-01T00:00:00.000Z",
        entries: [{ path: "/music/song.sid", name: "song.sid", type: "sid" as const }],
      };
      // Base64 encode the JSON
      const jsonStr = JSON.stringify(snapshot);
      const base64 = btoa(jsonStr);
      mockReadFile.mockResolvedValue({ data: base64 });

      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();

      expect(result).toEqual(snapshot);
    });

    it("returns null for invalid JSON", async () => {
      mockReadFile.mockResolvedValue({ data: btoa("invalid json") });

      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();

      expect(result).toBeNull();
    });

    it("writes snapshot to filesystem", async () => {
      const snapshot = {
        version: 1 as const,
        updatedAt: "2024-01-01T00:00:00.000Z",
        entries: [],
      };

      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      await storage.write(snapshot);

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("returns null when decoded data is empty (safeParse !raw branch)", async () => {
      // Empty string data decodes to empty string → safeParse(!raw) → null
      mockReadFile.mockResolvedValue({ data: "" });

      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();

      expect(result).toBeNull();
    });

    it("encodes using Buffer when btoa is unavailable", async () => {
      vi.stubGlobal("btoa", undefined);

      const snapshot = {
        version: 1 as const,
        updatedAt: "2024-01-01T00:00:00.000Z",
        entries: [],
      };
      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      await storage.write(snapshot);

      expect(mockWriteFile).toHaveBeenCalled();
      const writeArg = mockWriteFile.mock.calls[0][0];
      expect(typeof writeArg.data).toBe("string");

      vi.unstubAllGlobals();
    });

    it("decodes using Buffer when atob is unavailable", async () => {
      vi.stubGlobal("atob", undefined);

      const snapshot = {
        version: 1 as const,
        updatedAt: "2024-01-01T00:00:00.000Z",
        entries: [{ path: "/a.sid", name: "a.sid", type: "sid" as const }],
      };
      const base64 = Buffer.from(JSON.stringify(snapshot), "utf-8").toString("base64");
      mockReadFile.mockResolvedValue({ data: base64 });

      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      const result = await storage.read();

      expect(result).not.toBeNull();
      expect(result?.entries).toHaveLength(1);

      vi.unstubAllGlobals();
    });

    it("returns original value when atob throws (decodeUtf8Base64 catch branch)", async () => {
      vi.stubGlobal("atob", () => {
        throw new Error("atob failed");
      });

      mockReadFile.mockResolvedValue({ data: "notvalidbase64" });

      const { FilesystemMediaIndexStorage } = await import("./filesystemMediaIndex");
      const storage = new FilesystemMediaIndexStorage();
      // catch returns raw value → safeParse fails → null
      const result = await storage.read();

      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });
  });
});
