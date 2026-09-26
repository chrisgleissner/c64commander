/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

const listFtpDirectory = vi.fn();

vi.mock("@/lib/ftp/ftpClient", () => ({
  listFtpDirectory: (options: { path: string }) => listFtpDirectory(options.path),
  readFtpFile: vi.fn(),
  writeFtpFile: vi.fn(),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({
  resolveFtpConnectionOptions: async () => ({ host: "c64u", port: 21, password: "" }),
}));

import { buildDiskWriteBackDependencies } from "@/lib/disks/diskWriteBackDependencies";
import { resolvePersistentReuStorageRoot } from "@/lib/reu/reuWorkflow";

describe("buildDiskWriteBackDependencies", () => {
  it("does not offer an empty card slot as persistent storage", async () => {
    const tree: Record<string, { name: string; type: string }[]> = {
      "/": [
        { name: "SD", type: "dir" },
        { name: "Temp", type: "dir" },
        { name: "USB2", type: "dir" },
      ],
      "/SD": [],
      "/Temp": [],
      "/USB2": [{ name: "Games", type: "dir" }],
    };
    listFtpDirectory.mockImplementation(async (path: string) => ({ entries: tree[path] ?? [] }));

    const roots = await buildDiskWriteBackDependencies().listRemoteStorageRoots();

    expect(resolvePersistentReuStorageRoot(roots)).toBe("USB2");
  });
});
