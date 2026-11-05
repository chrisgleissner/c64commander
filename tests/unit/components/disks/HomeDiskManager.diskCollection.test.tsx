/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeDiskManager } from "@/components/disks/HomeDiskManager";
import { useC64ConfigItems, useC64Connection, useC64Drives } from "@/hooks/useC64Connection";
import { useDiskLibrary } from "@/hooks/useDiskLibrary";
import { getC64API } from "@/lib/c64api";
import { reportUserError } from "@/lib/uiErrors";
import type { DiskEntry } from "@/lib/disks/diskTypes";

type ListItem = { id: string; onAction?: () => void; actionLabel?: string; variant?: string };

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
vi.mock("@/hooks/useActionTrace", () => ({ useActionTrace: () => (fn: unknown) => fn }));
vi.mock("@/pages/playFiles/hooks/useArchiveClientSettings", () => ({
  useArchiveClientSettings: () => ({
    commoserveEnabled: false,
    archiveConfig: { id: "archive-commoserve", name: "CommoServe", baseUrl: "http://x", enabled: false },
  }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({ useFeatureFlagValue: () => true }));
vi.mock("@/components/disks/NewDiskDialog", () => ({
  NewDiskDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="new-disk-dialog-open" /> : null),
}));
vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({ ItemSelectionDialog: () => null }));
vi.mock("@/components/itemSelection/AddItemsProgressOverlay", () => ({ AddItemsProgressOverlay: () => null }));
vi.mock("@/components/lists/SelectableActionList", () => ({
  SelectableActionList: ({
    title,
    items,
    headerActions,
  }: {
    title: string;
    items: ListItem[];
    headerActions?: ReactNode;
  }) => (
    <div data-testid={`list-${title}`}>
      {headerActions}
      {items
        .filter((item) => item.variant !== "header")
        .map((item) => (
          <button key={item.id} type="button" data-testid={`mount-${item.id}`} onClick={item.onAction}>
            {item.actionLabel}
          </button>
        ))}
    </div>
  ),
}));

const diskNamed = (id: string) =>
  ({
    id,
    name: `${id}.d64`,
    path: `/${id}.d64`,
    location: "ultimate",
    group: null,
    importedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as DiskEntry;

const arrange = (disks: DiskEntry[], isConnected: boolean) => {
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
    status: { isConnected, state: isConnected ? "ready" : "offline", deviceInfo: { unique_id: "test-device" } },
  });
  (useDiskLibrary as ReturnType<typeof vi.fn>).mockReturnValue({
    disks,
    runtimeFiles: {},
    addDisks: vi.fn(),
    removeDisk: vi.fn(),
  });
  (useC64Drives as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { drives: [{ a: { bus_id: 8, enabled: true, image_file: "", image_path: "" } }] },
  });
  (useC64ConfigItems as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined });
};

const collectionToggle = () => screen.getByTestId("disks-section-toggle-disk-library");

describe("the Disk collection section of HomeDiskManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("reports that mounting needs a connection, and does not pick the disk, while the device is offline", () => {
    arrange([diskNamed("game")], false);
    render(<HomeDiskManager />);

    fireEvent.click(within(screen.getByTestId("list-Disk list")).getByTestId("mount-game"));

    expect(reportUserError).toHaveBeenCalledTimes(1);
    expect(reportUserError).toHaveBeenCalledWith({
      operation: "DISK_MOUNT",
      title: "Offline",
      description: "Connect to mount disks.",
    });
  });

  it("does not report anything when a disk is picked while the device is connected", () => {
    arrange([diskNamed("game")], true);
    render(<HomeDiskManager />);

    fireEvent.click(within(screen.getByTestId("list-Disk list")).getByTestId("mount-game"));

    expect(reportUserError).not.toHaveBeenCalled();
  });

  it("opens the new disk dialog from the section's New disk button", () => {
    arrange([], true);
    render(<HomeDiskManager />);

    expect(screen.queryByTestId("new-disk-dialog-open")).toBeNull();
    fireEvent.click(screen.getByTestId("new-disk-open"));

    expect(screen.getByTestId("new-disk-dialog-open")).toBeInTheDocument();
  });

  it("summarizes the collection as one disk, then as several", () => {
    arrange([diskNamed("one")], true);
    const first = render(<HomeDiskManager />);
    expect(collectionToggle()).toHaveTextContent(/1 disk$/);
    first.unmount();

    arrange([diskNamed("one"), diskNamed("two")], true);
    render(<HomeDiskManager />);
    expect(collectionToggle()).toHaveTextContent(/2 disks$/);
  });
});
