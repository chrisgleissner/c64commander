import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/disks/diskStore", () => ({
  loadDiskLibrary: vi.fn(() => ({ disks: [] })),
  saveDiskLibrary: vi.fn(),
}));

vi.mock("@/lib/disks/diskTree", () => ({
  buildDiskTreeState: vi.fn(() => ({
    groups: [],
    files: [],
    allFiles: [],
    empty: true,
  })),
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

describe("useDiskLibrary device switch guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("preserves pre-switch disks and rejects stale post-switch additions", async () => {
    vi.resetModules();
    const store = await import("@/lib/savedDevices/store");
    const { useDiskLibrary } = await import("@/hooks/useDiskLibrary");
    const { createDiskEntry } = await import("@/lib/disks/diskTypes");

    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: false,
    });

    const firstDisk = createDiskEntry({ path: "/device-a.d64", location: "local" });
    const lateDisk = createDiskEntry({ path: "/device-b.d64", location: "local" });
    const { result } = renderHook(() => useDiskLibrary("shared"));

    act(() => {
      result.current.addDisks([firstDisk], {}, { expectedSelectedDeviceId: initialDeviceId });
    });

    act(() => {
      store.selectSavedDevice("device-backup");
    });

    expect(() => {
      act(() => {
        result.current.addDisks([lateDisk], {}, { expectedSelectedDeviceId: initialDeviceId });
      });
    }).toThrow(/Add items scan cancelled/);

    expect(result.current.disks.map((disk) => disk.id)).toEqual([firstDisk.id]);
  });

  it("still adds disks when the selected device has not changed", async () => {
    vi.resetModules();
    const store = await import("@/lib/savedDevices/store");
    const { useDiskLibrary } = await import("@/hooks/useDiskLibrary");
    const { createDiskEntry } = await import("@/lib/disks/diskTypes");

    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    const disk = createDiskEntry({ path: "/device-a.d64", location: "local" });
    const { result } = renderHook(() => useDiskLibrary("shared"));

    act(() => {
      result.current.addDisks([disk], {}, { expectedSelectedDeviceId: initialDeviceId });
    });

    expect(result.current.disks.map((entry) => entry.id)).toEqual([disk.id]);
  });
});
