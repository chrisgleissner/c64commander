/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const listFtpDirectory = vi.fn();
const readFtpFile = vi.fn();
const writeFtpFile = vi.fn();
const selectedDevice = vi.hoisted(() => ({ current: { ftpPort: 21, password: "c64u-secret" } }));

vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: (options: { host: string; path: string }) => listFtpDirectory(options),
  readFtpFile: (options: { host: string; path: string }) => readFtpFile(options),
  writeFtpFile: (options: { host: string; path: string }) => writeFtpFile(options),
}));
vi.mock("@/lib/ftp/ftpConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ftp/ftpConfig")>()),
  getStoredFtpPort: () => selectedDevice.current.ftpPort,
}));
vi.mock("@/lib/secureStorage", () => ({
  getPassword: async () => selectedDevice.current.password,
}));

import { buildDiskWriteBackDependencies } from "@/lib/disks/diskWriteBackDependencies";
import { resolvePersistentReuStorageRoot } from "@/lib/reu/reuWorkflow";

describe("buildDiskWriteBackDependencies", () => {
  beforeEach(() => {
    selectedDevice.current = { ftpPort: 21, password: "c64u-secret" };
    listFtpDirectory.mockReset();
    readFtpFile.mockReset();
    writeFtpFile.mockReset();
  });

  it("does not offer an empty card slot as persistent storage", async () => {
    const tree: Record<string, { name: string; type: string }[]> = {
      "/": [
        { name: "SD", type: "dir" },
        { name: "Temp", type: "dir" },
        { name: "USB2", type: "dir" },
      ],
      "/SD": [{ name: "SD", type: "dir" }],
      "/Temp": [],
      "/USB2": [{ name: "Games", type: "dir" }],
    };
    listFtpDirectory.mockImplementation(async (options: { path: string }) => ({ entries: tree[options.path] ?? [] }));

    const roots = await buildDiskWriteBackDependencies("c64u").listRemoteStorageRoots();

    expect(resolvePersistentReuStorageRoot(roots)).toBe("USB2");
  });

  it("keeps reading and writing work files on the device it was built for after the selection changes", async () => {
    readFtpFile.mockResolvedValue({ data: "" });
    const deps = buildDiskWriteBackDependencies("c64u:80");
    selectedDevice.current = { ftpPort: 2121, password: "u64-secret" };

    await deps.readRemoteFile("/USB2/work/drive-a.d64");
    await deps.writeRemoteFile("/USB2/work/drive-a.d64", new Uint8Array([1]));

    const boundOptions = { host: "c64u", port: 21, password: "c64u-secret" };
    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining(boundOptions));
    expect(writeFtpFile).toHaveBeenCalledWith(expect.objectContaining(boundOptions));
  });
});
