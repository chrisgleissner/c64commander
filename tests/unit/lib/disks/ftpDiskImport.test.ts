/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { importFtpFile, importFtpFolder, listFtpEntries } from "@/lib/disks/ftpDiskImport";

const listFtpDirectoryMock = vi.fn();
const getStoredFtpPortMock = vi.fn(() => 21);

vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: (...args: unknown[]) => listFtpDirectoryMock(...args),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: () => getStoredFtpPortMock(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details: Record<string, unknown>) => ({
    error: error.message,
    ...details,
  })),
}));

describe("ftpDiskImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates disk entries with normalized metadata from FTP listings", async () => {
    listFtpDirectoryMock.mockImplementation(async ({ path }: { path: string }) => {
      if (path === "/Disks") {
        return {
          entries: [
            {
              name: "Summer Games 1.d64",
              path: "/Disks/Summer Games 1.d64",
              type: "file",
              size: 174848,
              modifiedAt: "2026-01-01T00:00:00Z",
            },
            {
              name: "Summer Games 2.d64",
              path: "/Disks/Summer Games 2.d64",
              type: "file",
              size: 174848,
              modifiedAt: "2026-01-02T00:00:00Z",
            },
            { name: "Extras", path: "/Disks/Extras", type: "dir" },
          ],
        };
      }
      return {
        entries: [
          {
            name: "Bonus.d81",
            path: "/Disks/Extras/Bonus.d81",
            type: "file",
            size: 819200,
            modifiedAt: "2026-01-03T00:00:00Z",
          },
        ],
      };
    });

    const disks = await importFtpFolder({ host: "c64u", path: "/Disks" });

    expect(disks).toHaveLength(3);
    expect(disks[0]).toMatchObject({
      name: "Summer Games 1.d64",
      path: "/Disks/Summer Games 1.d64",
      location: "ultimate",
      group: "Summer Games",
      sizeBytes: 174848,
      modifiedAt: "2026-01-01T00:00:00Z",
      importOrder: 0,
    });
    expect(disks[1]).toMatchObject({
      name: "Summer Games 2.d64",
      group: "Summer Games",
      importOrder: 1,
    });
    expect(disks[2]).toMatchObject({
      name: "Bonus.d81",
      path: "/Disks/Extras/Bonus.d81",
      group: "Extras",
      importOrder: 2,
    });
    expect(listFtpDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "c64u", port: 21, path: "/Disks" }),
    );
  });

  it("filters non-disk files while traversing FTP folders", async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [
        { name: "README.txt", path: "/Mixed/README.txt", type: "file", size: 100 },
        { name: "loader.prg", path: "/Mixed/loader.prg", type: "file", size: 200 },
        { name: "game.d64", path: "/Mixed/game.d64", type: "file", size: 174848 },
        { name: "second.D81", path: "/Mixed/second.D81", type: "file", size: 819200 },
      ],
    });

    const disks = await importFtpFolder({ host: "c64u", path: "/Mixed" });

    expect(disks.map((disk) => disk.name)).toEqual(["game.d64", "second.D81"]);
  });

  it("logs, rethrows, and propagates errors from walkFtpFolder", async () => {
    listFtpDirectoryMock.mockRejectedValue(new Error("connection refused"));

    await expect(importFtpFolder({ host: "c64u", path: "/Disks" })).rejects.toThrow("connection refused");
  });

  it("passes password to FTP directory listing", async () => {
    listFtpDirectoryMock.mockResolvedValue({ entries: [] });

    await importFtpFolder({ host: "c64u", password: "secret", path: "/Private" });

    expect(listFtpDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "c64u", password: "secret", path: "/Private" }),
    );
  });
});

describe("listFtpEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps listFtpDirectory and returns entries", async () => {
    listFtpDirectoryMock.mockResolvedValue({
      entries: [{ name: "game.d64", path: "/game.d64", type: "file" }],
    });

    const result = await listFtpEntries({ host: "c64u", path: "/" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("game.d64");
  });

  it("uses empty string for missing password", async () => {
    listFtpDirectoryMock.mockResolvedValue({ entries: [] });

    await listFtpEntries({ host: "c64u", path: "/" });

    expect(listFtpDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ password: "" }),
    );
  });
});

describe("importFtpFile", () => {
  it("creates a disk entry for a valid disk image path", () => {
    const entry = importFtpFile("/Disks/game.d64");
    expect(entry.name).toBe("game.d64");
    expect(entry.location).toBe("ultimate");
  });

  it("throws for a non-disk file path", () => {
    expect(() => importFtpFile("/files/readme.txt")).toThrow("Found no disk file.");
  });
});
