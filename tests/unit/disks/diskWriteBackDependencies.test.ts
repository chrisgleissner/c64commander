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
const resolvedHost = vi.hoisted(() => ({ current: "c64u" }));

vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: (options: { host: string; path: string }) => listFtpDirectory(options),
  readFtpFile: (options: { host: string; path: string }) => readFtpFile(options),
  writeFtpFile: (options: { host: string; path: string }) => writeFtpFile(options),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({
  resolveFtpConnectionOptions: async () => ({ host: resolvedHost.current, port: 21, password: "" }),
}));

import { buildDiskWriteBackDependencies } from "@/lib/disks/diskWriteBackDependencies";
import { resolvePersistentReuStorageRoot } from "@/lib/reu/reuWorkflow";

describe("buildDiskWriteBackDependencies", () => {
  beforeEach(() => {
    resolvedHost.current = "c64u";
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
    resolvedHost.current = "u64";

    await deps.readRemoteFile("/USB2/work/drive-a.d64");
    await deps.writeRemoteFile("/USB2/work/drive-a.d64", new Uint8Array([1]));

    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining({ host: "c64u" }));
    expect(writeFtpFile).toHaveBeenCalledWith(expect.objectContaining({ host: "c64u" }));
  });
});
