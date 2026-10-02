/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeDiskManager } from "@/components/disks/HomeDiskManager";
import { useC64ConfigItems, useC64Connection, useC64Drives } from "@/hooks/useC64Connection";
import { useDiskLibrary } from "@/hooks/useDiskLibrary";
import { getC64API } from "@/lib/c64api";
import { toast } from "@/hooks/use-toast";
import { reportUserError } from "@/lib/uiErrors";
import { mountDiskToDrive } from "@/lib/disks/diskMount";
import type { DiskEntry } from "@/lib/disks/diskTypes";

const explorer = vi.hoisted(() => ({ mount: null as ((disk: DiskEntry) => Promise<void>) | null }));

vi.mock("@/hooks/useC64Connection", () => ({
  useConnectionRoutingEpoch: () => 0,
  getC64DrivesQueryKey: () => ["c64-drives", 0],
  VISIBLE_C64_QUERY_OPTIONS: { intent: "user", refetchOnMount: "always" },
  useC64Connection: vi.fn(),
  useC64ConfigItems: vi.fn(),
  useC64Drives: vi.fn(),
}));
vi.mock("@/hooks/useDiskLibrary");
vi.mock("@/lib/c64api");
vi.mock("@/hooks/use-toast");
vi.mock("@/lib/uiErrors");
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    fetchQuery: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/lib/disks/diskMount", () => ({
  mountDiskToDrive: vi.fn(),
  finalizeDiskWriteBack: vi.fn().mockResolvedValue({ attempted: false }),
  discardDiskWriteBack: vi.fn(),
  hasShownDiskWriteBackAdvisory: vi.fn(() => true),
  markDiskWriteBackAdvisoryShown: vi.fn(),
  getMaterializedWorkPath: vi.fn(() => null),
  getMaterializedDiskId: vi.fn(() => null),
  hasShownArchiveDiskWriteBackAdvisory: vi.fn(() => true),
  markArchiveDiskWriteBackAdvisoryShown: vi.fn(),
  saveArchiveDiskCopyToLocalFolder: vi.fn(),
}));
vi.mock("@/lib/ftp/ftpClient", () => ({ listFtpDirectory: vi.fn(), readFtpFile: vi.fn(), writeFtpFile: vi.fn() }));
vi.mock("@/lib/ftp/ftpConfig", () => ({ resolveFtpConnectionOptions: vi.fn() }));
vi.mock("@/hooks/useActionTrace", () => ({ useActionTrace: () => (fn: unknown) => fn }));
vi.mock("@/pages/playFiles/hooks/useArchiveClientSettings", () => ({
  useArchiveClientSettings: () => ({
    commoserveEnabled: false,
    archiveConfig: { id: "archive-commoserve", name: "CommoServe", baseUrl: "http://x", enabled: false },
  }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlagValue: () => true }));
vi.mock("@/hooks/useDiskExplorer", () => ({
  diskTypeForPath: () => "d64",
  useDiskExplorer: (options: { mount: (disk: DiskEntry) => Promise<void> }) => {
    explorer.mount = options.mount;
    return {
      open: false,
      disk: null,
      entries: null,
      loading: false,
      error: null,
      busyIndex: null,
      openDisk: vi.fn(),
      runAction: vi.fn(),
      close: vi.fn(),
      setOpen: vi.fn(),
    };
  },
}));
vi.mock("@/components/disks/NewDiskDialog", () => ({
  NewDiskDialog: ({ onCreated }: { onCreated: (result: { filePath: string; fileName: string }) => Promise<void> }) => (
    <button
      type="button"
      data-testid="mock-new-disk-created"
      onClick={() => void onCreated({ filePath: "/Usb0/new.d64", fileName: "new.d64" })}
    >
      created
    </button>
  ),
}));
vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({ ItemSelectionDialog: () => null }));
vi.mock("@/components/itemSelection/AddItemsProgressOverlay", () => ({ AddItemsProgressOverlay: () => null }));
vi.mock("@/components/lists/SelectableActionList", () => ({ SelectableActionList: () => null }));

const disk = {
  id: "d1",
  name: "game.d64",
  path: "/game.d64",
  location: "ultimate",
  group: null,
  importedAt: "2026-01-01T00:00:00.000Z",
} as unknown as DiskEntry;

describe("HomeDiskManager reports a failed mount to the flows that continue after it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    explorer.mount = null;
    (getC64API as ReturnType<typeof vi.fn>).mockReturnValue({
      driveOn: vi.fn(),
      driveOff: vi.fn(),
      resetDrive: vi.fn(),
      mountDisk: vi.fn(),
      unmountDrive: vi.fn(),
      getBaseUrl: () => "http://mock-host",
      getDeviceHost: () => "mock-host",
    });
    (useC64Connection as ReturnType<typeof vi.fn>).mockReturnValue({
      status: { isConnected: true, state: "ready", deviceInfo: { unique_id: "test-device" } },
    });
    (useDiskLibrary as ReturnType<typeof vi.fn>).mockReturnValue({
      disks: [disk],
      runtimeFiles: {},
      addDisks: vi.fn(),
      removeDisk: vi.fn(),
    });
    (useC64Drives as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { drives: [{ a: { bus_id: 8, enabled: true, image_file: "", image_path: "" } }] },
    });
    (useC64ConfigItems as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined });
  });

  it("rejects the Disk Explorer mount step when the mount fails, so Mount & Load does not reset and type LOAD", async () => {
    (mountDiskToDrive as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Drive A is not reachable"));
    render(<HomeDiskManager />);

    expect(explorer.mount).not.toBeNull();
    await expect(explorer.mount!(disk)).rejects.toThrow(/game\.d64 was not mounted on drive A/);
    expect(reportUserError).toHaveBeenCalledWith(expect.objectContaining({ title: "Mount failed" }));
  });

  it("resolves the Disk Explorer mount step when the mount succeeds", async () => {
    (mountDiskToDrive as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ persistence: "device" });
    render(<HomeDiskManager />);

    await expect(explorer.mount!(disk)).resolves.toBeUndefined();
  });

  it("does not claim a new disk was mounted when its mount failed", async () => {
    (mountDiskToDrive as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Drive A is not reachable"));
    render(<HomeDiskManager />);

    fireEvent.click(screen.getByTestId("mock-new-disk-created"));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Disk created" }));
    });
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("created and mounted") }),
    );
  });
});
