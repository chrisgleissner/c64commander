/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/c64api", () => ({
  getC64APIConfigSnapshot: () => ({ deviceHost: "c64u.local", password: "pw" }),
}));
vi.mock("@/lib/ftp/ftpClient", () => ({
  readFtpFile: vi.fn(async () => ({ data: btoa("HELLO"), sizeBytes: 5 })),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));
vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({ normalizeFtpHost: (h: string) => h }));
vi.mock("@/lib/disks/diskMount", () => ({
  resolveLocalDiskBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3, 4])])),
}));

import { loadDiskImageBytes } from "@/hooks/useDiskExplorer";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { resolveLocalDiskBlob } from "@/lib/disks/diskMount";
import type { DiskEntry } from "@/lib/disks/diskTypes";

const disk = (overrides: Partial<DiskEntry>): DiskEntry => ({
  id: "x",
  path: "/GAMES/A.D64",
  location: "local",
  ...overrides,
});

describe("loadDiskImageBytes", () => {
  it("fetches ultimate disks over FTP and decodes base64", async () => {
    const bytes = await loadDiskImageBytes(disk({ location: "ultimate", path: "GAMES/A.D64" }));
    expect(readFtpFile).toHaveBeenCalledWith(
      expect.objectContaining({ host: "c64u.local", port: 21, password: "pw", path: "/GAMES/A.D64" }),
    );
    expect(new TextDecoder().decode(bytes)).toBe("HELLO");
  });

  it("resolves local disks via resolveLocalDiskBlob", async () => {
    const runtime = new File([new Uint8Array([9])], "A.D64");
    const bytes = await loadDiskImageBytes(disk({ location: "local" }), runtime);
    expect(resolveLocalDiskBlob).toHaveBeenCalled();
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});
