/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/c64api", () => ({
  getC64APIConfigSnapshot: () => ({ deviceHost: "c64u.local", password: "pw" }),
}));
vi.mock("@/lib/ftp/ftpClient", () => ({
  readFtpFile: vi.fn(async () => ({ data: btoa("HELLO"), sizeBytes: 5 })),
  listFtpDirectory: vi.fn(),
}));
vi.mock("@/lib/ftp/ftpConfig", () => ({ getStoredFtpPort: () => 21 }));
vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({ normalizeFtpHost: (h: string) => h }));
vi.mock("@/lib/disks/diskMount", () => ({
  resolveLocalDiskBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3, 4])])),
}));
vi.mock("@/lib/secureStorage", () => ({ getPasswordForDevice: vi.fn(async () => "u2pw") }));
vi.mock("@/lib/savedDevices/store", () => {
  const devices: Record<string, object> = {
    "dev-c64u": { id: "dev-c64u", host: "c64u.local", ftpPort: 21, lastKnownUniqueId: "C64U-1" },
    "dev-u2": { id: "dev-u2", host: "u2.local", ftpPort: 2121, lastKnownUniqueId: "U2-1" },
  };
  return {
    getSelectedSavedDevice: () => devices["dev-c64u"],
    getSavedDeviceById: (id: string) => devices[id] ?? null,
  };
});

import { loadDiskImageBytes } from "@/hooks/useDiskExplorer";
import { readFtpFile } from "@/lib/ftp/ftpClient";
import { resolveLocalDiskBlob } from "@/lib/disks/diskMount";
import type { DiskEntry } from "@/lib/disks/diskTypes";
import type { DeviceBoundContentOrigin } from "@/lib/savedDevices/deviceBoundOrigin";

const disk = (overrides: Partial<DiskEntry>): DiskEntry => ({
  id: "x",
  path: "/GAMES/A.D64",
  location: "local",
  ...overrides,
});

const originOn = (originDeviceId: string, originDeviceLastKnownUniqueId: string): DeviceBoundContentOrigin => ({
  sourceKind: "ultimate",
  originDeviceId,
  originDeviceLastKnownUniqueId,
  originPath: "/USB1/GAMES/A.D64",
  importedAt: "2026-09-26T00:00:00.000Z",
});

describe("loadDiskImageBytes", () => {
  beforeEach(() => {
    vi.mocked(readFtpFile).mockClear();
  });

  it("fetches ultimate disks over FTP and decodes base64", async () => {
    const bytes = await loadDiskImageBytes(disk({ location: "ultimate", path: "GAMES/A.D64" }));
    expect(readFtpFile).toHaveBeenCalledWith(
      expect.objectContaining({ host: "c64u.local", port: 21, password: "pw", path: "/GAMES/A.D64" }),
    );
    expect(new TextDecoder().decode(bytes)).toBe("HELLO");
  });

  it("reads an ultimate disk whose origin is another saved device from that device, not the selected one", async () => {
    const bytes = await loadDiskImageBytes(
      disk({ location: "ultimate", path: "/USB1/GAMES/A.D64", origin: originOn("dev-u2", "U2-1") }),
    );
    expect(readFtpFile).toHaveBeenCalledTimes(1);
    expect(readFtpFile).toHaveBeenCalledWith(
      expect.objectContaining({ host: "u2.local", port: 2121, password: "u2pw", path: "/USB1/GAMES/A.D64" }),
    );
    expect(new TextDecoder().decode(bytes)).toBe("HELLO");
  });

  it("reads an ultimate disk whose origin is the selected device from the selected device", async () => {
    await loadDiskImageBytes(disk({ location: "ultimate", origin: originOn("dev-c64u", "C64U-1") }));
    expect(readFtpFile).toHaveBeenCalledWith(expect.objectContaining({ host: "c64u.local", password: "pw" }));
  });

  it("resolves local disks via resolveLocalDiskBlob", async () => {
    const runtime = new File([new Uint8Array([9])], "A.D64");
    const bytes = await loadDiskImageBytes(disk({ location: "local" }), runtime);
    expect(resolveLocalDiskBlob).toHaveBeenCalled();
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});
